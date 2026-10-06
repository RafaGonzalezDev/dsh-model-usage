/**
 * Pure fold from durable session events to token usage per (provider, model).
 *
 * Two event types carry real provider usage: `assistant/message` reports one model step and
 * `compaction/summary` reports the summarization call that replaced older history. Every other
 * event type is ignored, including `assistant/attempt`, which carries no `usage` and no model.
 */

/** Every IANA zone offset is a whole number of 15-minute steps, so a local day boundary always
 * falls on a bucket boundary and instants can be re-bucketed into any zone without loss. */
export const BUCKET_MS = 900_000;

/** Provider recorded for a usage event that named a model but no provider. */
export const UNKNOWN_PROVIDER = 'unknown';

/** Token totals one series accumulated, plus the requests that reported them. */
export interface SeriesTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  /** Requests with finite non-negative reasoningTokens in the log, including explicit zero. */
  reasoningReported?: number;
  /** Requests attributed to an explicit logged effort, independent of reasoningTokens. */
  reasoningEfforts?: { effort: string; requests: number }[];
  requests: number;
}

/** Bucket index to series id to totals; the unit the cache stores and the aggregator merges. */
export type BucketTotals = Map<number, Map<string, SeriesTotals>>;

/** What one session contributed, plus the usage events that could not be attributed. */
export interface SessionContribution {
  buckets: BucketTotals;
  unusable: number;
}

/** The structural event surface the fold consumes; a durable session event satisfies it. */
export interface UsageEventLike {
  type: string;
  time?: number;
  data?: unknown;
}

/** Stable identity of one (provider, model) pair. */
export function seriesId(provider: string, model: string): string {
  return `${provider}\u0000${model}`;
}

/** Split a series id back into its provider and model halves. */
export function splitSeriesId(id: string): { provider: string; model: string } {
  const at = id.indexOf('\u0000');
  if (at < 0) return { provider: UNKNOWN_PROVIDER, model: id };
  return { provider: id.slice(0, at), model: id.slice(at + 1) };
}

/** Index of the 15-minute bucket one instant belongs to. */
export function bucketOf(timeMs: number): number {
  return Math.floor(timeMs / BUCKET_MS);
}

/** Start instant of one bucket. */
export function bucketStart(bucket: number): number {
  return bucket * BUCKET_MS;
}

/** A fresh all-zero total set. */
export function emptyTotals(): SeriesTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, requests: 0 };
}

/**
 * Total tokens of one series.
 *
 * The Harness normalizes provider usage into four disjoint components: input tokens are the
 * *uncached* prompt, cache reads and cache writes are billed prompt tokens reported apart, and
 * reasoning tokens are already included in the output. The provider total is therefore the sum of
 * the four components, and reasoning is never added again.
 */
export function totalTokens(totals: SeriesTotals): number {
  return totals.input + totals.output + totals.cacheRead + totals.cacheWrite;
}

type TargetRead =
  | { kind: 'ignore' }
  | { kind: 'unusable' }
  | { kind: 'usage'; provider: string; model: string; usage: Record<string, unknown> | undefined };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** The four disjoint components of one usage record, after reconciling it with its own total. */
interface UsageParts {
  /** Prompt tokens that were not served from or written to the provider cache. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
}

/**
 * Split one usage record into disjoint components.
 *
 * The Harness normalizes adapters differently, and each record states which convention it used:
 * an OpenAI-compatible adapter reports the *uncached* prompt apart from the cache and totals
 * `input + output + cache + write`, while the ChatGPT-plan adapter reports a prompt that already
 * contains the cache and totals `input + output`. Reconciling against the record's own
 * `totalTokens` needs no provider table and keeps the four components adding up to the provider
 * total in both conventions. Without a usable total the components are taken as disjoint, which is
 * the convention of the adapters that report them apart.
 */
function usageParts(usage: Record<string, unknown> | undefined): UsageParts {
  const rawInput = count(usage?.['inputTokens']);
  const output = count(usage?.['outputTokens']);
  const cacheRead = count(usage?.['cacheReadTokens']);
  const cacheWrite = count(usage?.['cacheWriteTokens']);
  const total = usage?.['totalTokens'];
  const reported = typeof total === 'number' && Number.isFinite(total) && total >= 0 ? Math.floor(total) : undefined;
  const cached = cacheRead + cacheWrite;
  const inclusive = reported !== undefined && cached > 0 && reported === rawInput + output;
  return {
    input: inclusive ? Math.max(0, rawInput - cached) : rawInput,
    output,
    cacheRead,
    cacheWrite,
    reasoning: count(usage?.['reasoningTokens']),
  };
}

function readTarget(event: UsageEventLike): TargetRead {
  if (!isRecord(event.data)) return event.type === 'assistant/message' || event.type === 'compaction/summary' ? { kind: 'unusable' } : { kind: 'ignore' };
  const data = event.data;
  if (event.type === 'assistant/message') {
    const message = isRecord(data.message) ? data.message : undefined;
    const source = message && isRecord(message.source) ? message.source : undefined;
    const model = source ? text(source.model) : undefined;
    if (!model) return { kind: 'unusable' };
    return {
      kind: 'usage',
      provider: (source && text(source.provider)) ?? UNKNOWN_PROVIDER,
      model,
      usage: isRecord(data.usage) ? data.usage : undefined,
    };
  }
  if (event.type === 'compaction/summary') {
    const model = text(data.model);
    if (!model) return { kind: 'unusable' };
    return {
      kind: 'usage',
      provider: text(data.provider) ?? UNKNOWN_PROVIDER,
      model,
      usage: isRecord(data.usage) ? data.usage : undefined,
    };
  }
  return { kind: 'ignore' };
}

/** Fold one session log into per-bucket, per-series totals. */
export function foldSession(events: readonly UsageEventLike[]): SessionContribution {
  const buckets: BucketTotals = new Map();
  let unusable = 0;
  let config: Record<string, unknown> | undefined;
  for (const event of events) {
    if (event.type === 'request/header') {
      const header = isRecord(event.data) && isRecord(event.data.header) ? event.data.header : undefined;
      config = header && isRecord(header.config) ? header.config : undefined;
      continue;
    }
    const read = readTarget(event);
    if (read.kind === 'ignore') continue;
    const time = event.time;
    if (read.kind === 'unusable' || typeof time !== 'number' || !Number.isFinite(time)) { unusable++; continue; }
    const bucket = bucketOf(time);
    let series = buckets.get(bucket);
    if (series === undefined) { series = new Map(); buckets.set(bucket, series); }
    const id = seriesId(read.provider, read.model);
    const totals = series.get(id) ?? emptyTotals();
    const parts = usageParts(read.usage);
    totals.input += parts.input;
    totals.output += parts.output;
    totals.cacheRead += parts.cacheRead;
    totals.cacheWrite += parts.cacheWrite;
    const reasoning = read.usage?.['reasoningTokens'];
    totals.reasoning += parts.reasoning;
    if (typeof reasoning === 'number' && Number.isFinite(reasoning) && reasoning >= 0) {
      totals.reasoningReported = (totals.reasoningReported ?? 0) + 1;
    }
    const effort = event.type === 'assistant/message' && config?.provider === read.provider && config.model === read.model
      ? text(config.reasoningEffort) : undefined;
    if (effort !== undefined) {
      const efforts = totals.reasoningEfforts ??= [];
      const entry = efforts.find(item => item.effort === effort);
      if (entry) entry.requests++;
      else efforts.push({ effort, requests: 1 });
      efforts.sort((a, b) => a.effort.localeCompare(b.effort));
    }
    totals.requests += 1;
    series.set(id, totals);
  }
  return { buckets, unusable };
}

/** Add one series table into another, summing per series id. */
export function mergeSeries(target: Map<string, SeriesTotals>, source: Map<string, SeriesTotals>): void {
  for (const [id, totals] of source) {
    const current = target.get(id);
    if (current === undefined) {
      target.set(id, { ...totals, ...(totals.reasoningEfforts ? { reasoningEfforts: totals.reasoningEfforts.map(entry => ({ ...entry })) } : {}) });
      continue;
    }
    if (totals.reasoningEfforts) {
      const efforts = current.reasoningEfforts ??= [];
      for (const entry of totals.reasoningEfforts) {
        const existing = efforts.find(item => item.effort === entry.effort);
        if (existing) existing.requests += entry.requests;
        else efforts.push({ ...entry });
      }
      efforts.sort((a, b) => a.effort.localeCompare(b.effort));
    }
    current.input += totals.input;
    current.output += totals.output;
    current.cacheRead += totals.cacheRead;
    current.cacheWrite += totals.cacheWrite;
    current.reasoning += totals.reasoning;
    if (totals.reasoningReported !== undefined) {
      current.reasoningReported = (current.reasoningReported ?? 0) + totals.reasoningReported;
    }
    current.requests += totals.requests;
  }
}

/** Add one contribution into a bucket table, summing per series. */
export function mergeInto(target: BucketTotals, source: BucketTotals): void {
  for (const [bucket, series] of source) {
    let into = target.get(bucket);
    if (into === undefined) { into = new Map(); target.set(bucket, into); }
    mergeSeries(into, series);
  }
}
