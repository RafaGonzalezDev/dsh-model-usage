/**
 * Independent recount of the usage the dashboard reports.
 *
 * It reads the persisted session logs directly and accumulates the four normalized usage
 * components with its own logic, instead of trusting the plugin's fold. It then cross-checks
 * three things: the fold the plugin uses, the `totalTokens` each provider recorded, and the
 * aggregate cache the Host wrote.
 *
 * The Harness normalizes provider usage into four disjoint components: `inputTokens` is the
 * *uncached* prompt, `cacheReadTokens` and `cacheWriteTokens` are billed prompt tokens reported
 * apart, and `reasoningTokens` is already included in `outputTokens`. The provider total is
 * therefore `input + output + cacheRead + cacheWrite`.
 *
 * A running Host also counts sessions that are not persisted yet, so a live session can make the
 * cached total larger than this recount; the comparison reports the difference instead of hiding it.
 *
 * Usage: node scripts/verify-usage.ts [--home <dsh home>] [--cache <usage-v1.json>]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { cacheTotals, parseCache } from '../packages/plugin/src/cache.ts';
import { foldSession, mergeInto, seriesId, splitSeriesId, totalTokens, type BucketTotals, type UsageEventLike } from '../packages/plugin/src/fold.ts';

const SESSION_FILE = 'session.v4.jsonl.zstd';

/** First four bytes of a standard zstd frame. */
const FRAME_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/**
 * Decompress a whole session log.
 *
 * The JSONL backend appends one frame per durable batch, and Node's zstd API stops at the end of
 * the first frame, so the stream is split at frame boundaries and each frame is decoded on its
 * own. A candidate boundary that does not decode is not a boundary: the slice is extended to the
 * next one. Skippable frames are not expected in this format and are not handled.
 */
function decompressFrames(bytes: Buffer): Buffer {
  const parts: Buffer[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = bytes.indexOf(FRAME_MAGIC, start + FRAME_MAGIC.length);
    let decoded: Buffer | undefined;
    while (decoded === undefined) {
      try {
        decoded = zstdDecompressSync(bytes.subarray(start, end < 0 ? bytes.length : end));
      } catch (error) {
        if (end < 0) throw error;
        end = bytes.indexOf(FRAME_MAGIC, end + FRAME_MAGIC.length);
      }
    }
    parts.push(decoded);
    if (end < 0) break;
    start = end;
  }
  return Buffer.concat(parts);
}

function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  const value = at < 0 ? undefined : process.argv[at + 1];
  return value ?? fallback;
}

function sessionLogs(root: string): string[] {
  const found: string[] = [];
  let workspaces: string[];
  try {
    workspaces = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => join(root, entry.name));
  } catch {
    return found;
  }
  for (const workspace of workspaces) {
    for (const entry of readdirSync(workspace, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = join(workspace, entry.name, SESSION_FILE);
      try {
        readFileSync(file);
        found.push(file);
      } catch {
        // A session directory without a persisted log is simply not counted here.
      }
    }
  }
  return found;
}

function eventsOf(file: string): UsageEventLike[] {
  const text = decompressFrames(readFileSync(file)).toString('utf8');
  const events: UsageEventLike[] = [];
  for (const line of text.split('\n')) {
    if (line.length === 0) continue;
    try {
      events.push(JSON.parse(line) as UsageEventLike);
    } catch {
      // A torn tail is not a reason to abandon the recount.
    }
  }
  return events;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Same rule as the fold: a missing, negative or non-finite counter contributes zero. */
function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** Which convention one record's own `totalTokens` proves it used. */
type Convention = 'disjoint' | 'inclusive' | 'absent' | 'unreconciled';

interface Normalized {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reported: number | undefined;
  convention: Convention;
}

/**
 * Normalize one usage record the same way the plugin fold does, but independently.
 *
 * `disjoint` means the record totals `input + output + cache + write` (OpenAI-compatible
 * adapters, which report the uncached prompt apart from the cache). `inclusive` means it totals
 * `input + output`, so its prompt already contains the cache. `absent` means the record carried no
 * usable total and the components are taken as disjoint.
 */
function normalize(usage: Record<string, unknown> | undefined): Normalized {
  const rawInput = count(usage?.['inputTokens']);
  const output = count(usage?.['outputTokens']);
  const cacheRead = count(usage?.['cacheReadTokens']);
  const cacheWrite = count(usage?.['cacheWriteTokens']);
  const total = usage?.['totalTokens'];
  const reported = typeof total === 'number' && Number.isFinite(total) && total >= 0 ? Math.floor(total) : undefined;
  const cached = cacheRead + cacheWrite;
  if (reported === undefined) {
    return { input: rawInput, output, cacheRead, cacheWrite, reported, convention: 'absent' };
  }
  const disjoint = reported === rawInput + output + cached;
  const inclusive = reported === rawInput + output;
  if (disjoint) return { input: rawInput, output, cacheRead, cacheWrite, reported, convention: 'disjoint' };
  if (inclusive) return { input: Math.max(0, rawInput - cached), output, cacheRead, cacheWrite, reported, convention: 'inclusive' };
  return { input: rawInput, output, cacheRead, cacheWrite, reported, convention: 'unreconciled' };
}

/** One series as this script counts it, with the provider total kept for cross-checking. */
interface Components {
  provider: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  requests: number;
  /** Sum of the `totalTokens` values this series actually recorded. */
  reportedTotal: number;
  /** Usage records that carried a usable `totalTokens`. */
  reportedCount: number;
  /** Records whose own total proves the cache sits inside its prompt. */
  inclusive: number;
  /** Records whose recorded total neither convention explains. */
  unreconciled: number;
}

/** The four-component total of one accumulated series. */
function tokensOf(row: Components): number {
  return row.input + row.output + row.cacheRead + row.cacheWrite;
}

/** Read one event's usage without going through the plugin's own target reader. */
function usageOf(event: UsageEventLike): { provider: string; model: string; usage: Record<string, unknown> | undefined } | undefined {
  if (!isRecord(event.data)) return undefined;
  const data = event.data;
  if (event.type === 'assistant/message') {
    const message = isRecord(data.message) ? data.message : undefined;
    const source = message && isRecord(message.source) ? message.source : undefined;
    if (source === undefined || typeof source.model !== 'string' || source.model.length === 0) return undefined;
    return {
      provider: typeof source.provider === 'string' && source.provider.length > 0 ? source.provider : 'unknown',
      model: source.model,
      usage: isRecord(data.usage) ? data.usage : undefined,
    };
  }
  if (event.type === 'compaction/summary') {
    if (typeof data.model !== 'string' || data.model.length === 0) return undefined;
    return {
      provider: typeof data.provider === 'string' && data.provider.length > 0 ? data.provider : 'unknown',
      model: data.model,
      usage: isRecord(data.usage) ? data.usage : undefined,
    };
  }
  return undefined;
}

function main(): void {
  const home = argument('home', join(homedir(), '.dsh'));
  const cachePath = argument('cache', join(home, 'profiles', 'desktop', '.cache', 'dsh-model-usage', 'usage-v1.json'));
  const logs = sessionLogs(join(home, 'sessions'));

  // This script's own accumulation.
  const bySeries = new Map<string, Components>();
  // The same logs through the plugin fold, for a cross-check.
  const foldBuckets: BucketTotals = new Map();
  let unusable = 0;
  let records = 0;

  for (const file of logs) {
    const events = eventsOf(file);
    const fold = foldSession(events);
    unusable += fold.unusable;
    mergeInto(foldBuckets, fold.buckets);
    for (const event of events) {
      const read = usageOf(event);
      if (read === undefined) continue;
      records += 1;
      const id = seriesId(read.provider, read.model);
      const row = bySeries.get(id) ?? {
        provider: read.provider, model: read.model,
        input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0,
        reportedTotal: 0, reportedCount: 0, inclusive: 0, unreconciled: 0,
      };
      const parts = normalize(read.usage);
      row.input += parts.input;
      row.output += parts.output;
      row.cacheRead += parts.cacheRead;
      row.cacheWrite += parts.cacheWrite;
      row.requests += 1;
      if (parts.reported !== undefined) {
        row.reportedTotal += parts.reported;
        row.reportedCount += 1;
        if (parts.convention === 'inclusive') row.inclusive += 1;
        if (parts.convention === 'unreconciled') row.unreconciled += 1;
      }
      bySeries.set(id, row);
    }
  }

  const rows = [...bySeries.values()].sort((a, b) => tokensOf(b) - tokensOf(a) || a.model.localeCompare(b.model));
  const tokens = rows.reduce((sum, row) => sum + tokensOf(row), 0);
  const requests = rows.reduce((sum, row) => sum + row.requests, 0);
  const reported = rows.reduce((sum, row) => sum + row.reportedTotal, 0);
  const reportedCount = rows.reduce((sum, row) => sum + row.reportedCount, 0);
  const inclusive = rows.reduce((sum, row) => sum + row.inclusive, 0);
  const unreconciled = rows.reduce((sum, row) => sum + row.unreconciled, 0);

  console.log(`session logs      ${logs.length}`);
  console.log(`usage records     ${records.toLocaleString('en-US')}`);
  console.log(`series            ${rows.length}`);
  console.log(`unattributed      ${unusable}`);
  console.log(`total tokens      ${tokens.toLocaleString('en-US')}`);
  console.log(`requests          ${requests.toLocaleString('en-US')}`);
  console.log('');

  console.log(
    'provider'.padEnd(20) + 'model'.padEnd(30)
    + 'tokens'.padStart(14) + 'requests'.padStart(10)
    + 'uncached'.padStart(14) + 'output'.padStart(12)
    + 'cache read'.padStart(14) + 'cache write'.padStart(13),
  );
  for (const row of rows) {
    console.log(
      row.provider.padEnd(20) + row.model.padEnd(30)
      + tokensOf(row).toLocaleString('en-US').padStart(14) + String(row.requests).padStart(10)
      + row.input.toLocaleString('en-US').padStart(14) + row.output.toLocaleString('en-US').padStart(12)
      + row.cacheRead.toLocaleString('en-US').padStart(14) + row.cacheWrite.toLocaleString('en-US').padStart(13),
    );
  }

  // The plugin fold and this recount must agree component by component.
  const folded = new Map<string, { tokens: number; requests: number }>();
  for (const series of foldBuckets.values()) {
    for (const [id, totals] of series) {
      const row = folded.get(id) ?? { tokens: 0, requests: 0 };
      row.tokens += totalTokens(totals);
      row.requests += totals.requests;
      folded.set(id, row);
    }
  }
  const foldTokens = [...folded.values()].reduce((sum, row) => sum + row.tokens, 0);
  const foldRequests = [...folded.values()].reduce((sum, row) => sum + row.requests, 0);
  const foldTokenDelta = foldTokens - tokens;
  const foldRequestDelta = foldRequests - requests;
  console.log('');
  console.log(`fold tokens       ${foldTokens.toLocaleString('en-US')} (delta ${foldTokenDelta >= 0 ? '+' : ''}${foldTokenDelta.toLocaleString('en-US')})`);
  console.log(`fold requests     ${foldRequests.toLocaleString('en-US')} (delta ${foldRequestDelta >= 0 ? '+' : ''}${foldRequestDelta.toLocaleString('en-US')})`);
  console.log(foldTokenDelta === 0 && foldRequestDelta === 0
    ? 'the plugin fold and this recount agree.'
    : 'the plugin fold and this recount disagree: one of the two is wrong, not merely out of date.');

  console.log('');
  if (reportedCount === 0) {
    console.log('no usage record carried totalTokens: the components were taken as disjoint.');
  } else {
    const delta = reported - tokens;
    console.log(`recorded totals   ${reported.toLocaleString('en-US')} over ${reportedCount.toLocaleString('en-US')} of ${records.toLocaleString('en-US')} records (delta ${delta >= 0 ? '+' : ''}${delta.toLocaleString('en-US')})`);
    console.log(`${inclusive.toLocaleString('en-US')} records keep the cache inside their prompt and were normalized against their own total:`);
    for (const row of rows.filter(item => item.inclusive > 0)) console.log(`  ${row.provider}/${row.model}: ${row.inclusive.toLocaleString('en-US')}`);
    if (unreconciled > 0) {
      console.log(`${unreconciled.toLocaleString('en-US')} records report a totalTokens that neither convention explains, so their components cannot be trusted:`);
      for (const row of rows.filter(item => item.unreconciled > 0)) console.log(`  ${row.provider}/${row.model}: ${row.unreconciled.toLocaleString('en-US')}`);
    } else {
      console.log('every recorded total is explained by one of the two conventions.');
    }
    if (delta !== 0 && unreconciled === 0) {
      console.log('The difference comes from records without totalTokens, which only the components cover.');
    }
  }

  let cachedText: string | undefined;
  try {
    cachedText = readFileSync(cachePath, 'utf8');
  } catch {
    console.log(`\nno aggregate cache at ${cachePath}: nothing to compare yet.`);
    return;
  }
  const cache = parseCache(cachedText);
  if (cache === undefined) {
    console.log(`\nthe aggregate cache at ${cachePath} is unreadable or from another schema.`);
    process.exitCode = 1;
    return;
  }
  const fromCache = cacheTotals(cache);
  const tokenDelta = fromCache.tokens - tokens;
  const requestDelta = fromCache.requests - requests;
  console.log('');
  console.log(`cached tokens     ${fromCache.tokens.toLocaleString('en-US')} (delta ${tokenDelta >= 0 ? '+' : ''}${tokenDelta.toLocaleString('en-US')})`);
  console.log(`cached requests   ${fromCache.requests.toLocaleString('en-US')} (delta ${requestDelta >= 0 ? '+' : ''}${requestDelta.toLocaleString('en-US')})`);
  console.log(tokenDelta === 0 && requestDelta === 0
    ? 'the cached aggregate matches this recount exactly.'
    : 'A positive delta is a live session the cached aggregate counts and a file recount cannot see; a negative one is activity written after the last scan. Re-run both against an idle profile to compare them exactly.');
}

main();
