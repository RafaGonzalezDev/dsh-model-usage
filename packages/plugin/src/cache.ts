/**
 * The durable aggregate cache.
 *
 * One entry per session holds that session's whole contribution, so a changed session replaces
 * its own numbers instead of being added twice. Buckets older than the retention window are
 * folded into a monthly archive: the archive keeps `allTime` correct while the file stays
 * bounded, and it can never intersect a range the dashboard offers.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { bucketStart, mergeSeries, totalTokens, type BucketTotals, type SeriesTotals } from './fold.ts';

/** On-disk schema version; a mismatch discards the file and rebuilds it.
 * Version 4 stores the cache-write component that version 3 never kept. */
export const CACHE_VERSION = 4;

/** One session's cached contribution and the signature it was folded from. */
export interface CachedSession {
  /** Persistence revision (plus cheap counts) the contribution was folded from. */
  sig: string;
  buckets: BucketTotals;
}

/** Month key to series id to totals, for buckets that left the retention window. */
export type ArchivedTotals = Map<string, Map<string, SeriesTotals>>;

export interface UsageCache {
  sessions: Map<string, CachedSession>;
  archive: ArchivedTotals;
}

/** A cache with nothing in it. */
export function emptyCache(): UsageCache {
  return { sessions: new Map(), archive: new Map() };
}

/** Components, requests and the optional reasoning coverage/efforts. */
type SerializedTotals = [number, number, number, number, number, number, (number | null)?, { effort: string; requests: number }[]?];

function toArray(totals: SeriesTotals): SerializedTotals {
  const value: SerializedTotals = [totals.input, totals.output, totals.cacheRead, totals.cacheWrite, totals.reasoning, totals.requests];
  if (totals.reasoningReported !== undefined || totals.reasoningEfforts !== undefined) value[6] = totals.reasoningReported ?? null;
  if (totals.reasoningEfforts !== undefined) value[7] = totals.reasoningEfforts;
  return value;
}

function fromArray(value: unknown): SeriesTotals | undefined {
  if (!Array.isArray(value) || value.length < 6 || value.length > 8) return undefined;
  const [input, output, cacheRead, cacheWrite, reasoning, requests, reported, reasoningEfforts] = value;
  if (![input, output, cacheRead, cacheWrite, reasoning, requests].every(item => typeof item === 'number' && Number.isFinite(item))) return undefined;
  const reasoningReported = reported === null && value.length === 8 ? undefined : reported;
  if (reasoningReported !== undefined && (typeof reasoningReported !== 'number' || !Number.isSafeInteger(reasoningReported) || reasoningReported < 0 || reasoningReported > requests)) return undefined;
  if (value.length === 8) {
    if (!Array.isArray(reasoningEfforts)) return undefined;
    const seen = new Set<string>();
    let count = 0;
    for (const entry of reasoningEfforts) {
      if (!isRecord(entry) || typeof entry.effort !== 'string' || entry.effort.length === 0 || seen.has(entry.effort)
        || typeof entry.requests !== 'number' || !Number.isSafeInteger(entry.requests) || entry.requests <= 0) return undefined;
      seen.add(entry.effort);
      count += entry.requests;
    }
    if (count > requests) return undefined;
  }
  return { input, output, cacheRead, cacheWrite, reasoning, requests, ...(reasoningReported === undefined ? {} : { reasoningReported }),
    ...(reasoningEfforts === undefined ? {} : { reasoningEfforts }) } as SeriesTotals;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBuckets(value: unknown): BucketTotals {
  const buckets: BucketTotals = new Map();
  if (!isRecord(value)) return buckets;
  for (const [bucketKey, seriesValue] of Object.entries(value)) {
    const bucket = Number(bucketKey);
    if (!Number.isInteger(bucket) || !isRecord(seriesValue)) continue;
    const series = new Map<string, SeriesTotals>();
    for (const [id, totalsValue] of Object.entries(seriesValue)) {
      const totals = fromArray(totalsValue);
      if (totals !== undefined) series.set(id, totals);
    }
    if (series.size > 0) buckets.set(bucket, series);
  }
  return buckets;
}

/** Read a cache file, or undefined when it is absent, corrupt or from another schema. */
export function parseCache(text: string | undefined): UsageCache | undefined {
  if (text === undefined || text.length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || parsed['version'] !== CACHE_VERSION) return undefined;
  const cache = emptyCache();
  const sessions = parsed['sessions'];
  if (isRecord(sessions)) {
    for (const [id, entryValue] of Object.entries(sessions)) {
      if (!isRecord(entryValue)) continue;
      const sig = entryValue['sig'];
      if (typeof sig !== 'string' || sig.length === 0) continue;
      const buckets = parseBuckets(entryValue['buckets']);
      if (buckets.size > 0) cache.sessions.set(id, { sig, buckets });
    }
  }
  const archive = parsed['archive'];
  if (isRecord(archive)) {
    for (const [month, seriesValue] of Object.entries(archive)) {
      if (!isRecord(seriesValue)) continue;
      const series = new Map<string, SeriesTotals>();
      for (const [id, totalsValue] of Object.entries(seriesValue)) {
        const totals = fromArray(totalsValue);
        if (totals !== undefined) series.set(id, totals);
      }
      if (series.size > 0) cache.archive.set(month, series);
    }
  }
  return cache;
}

/** Serialize the cache; sessions with no signature are in-memory only and never written. */
export function serializeCache(cache: UsageCache, generatedAt: number): string {
  const sessions: Record<string, { sig: string; buckets: Record<string, Record<string, SerializedTotals>> }> = {};
  for (const [id, entry] of cache.sessions) {
    if (entry.sig.length === 0 || entry.buckets.size === 0) continue;
    const buckets: Record<string, Record<string, SerializedTotals>> = {};
    for (const [bucket, series] of entry.buckets) {
      const encoded: Record<string, SerializedTotals> = {};
      for (const [seriesKey, totals] of series) encoded[seriesKey] = toArray(totals);
      buckets[String(bucket)] = encoded;
    }
    sessions[id] = { sig: entry.sig, buckets };
  }
  const archive: Record<string, Record<string, SerializedTotals>> = {};
  for (const [month, series] of cache.archive) {
    const encoded: Record<string, SerializedTotals> = {};
    for (const [id, totals] of series) encoded[id] = toArray(totals);
    archive[month] = encoded;
  }
  return JSON.stringify({ version: CACHE_VERSION, generatedAt, sessions, archive });
}

/**
 * Move the buckets that fell out of the retention window into the monthly archive.
 * @param cache - cache to compact in place.
 * @param now - reference instant.
 * @param retentionDays - how many days of per-session detail to keep.
 * @param zone - zone whose months name the archive entries.
 * @param monthOf - maps an instant to its `YYYY-MM` key.
 */
export function compactArchive(
  cache: UsageCache,
  now: number,
  retentionDays: number,
  monthOf: (instant: number) => string,
): void {
  const cutoff = now - retentionDays * 86_400_000;
  for (const entry of cache.sessions.values()) {
    for (const [bucket, series] of [...entry.buckets]) {
      if (bucketStart(bucket) >= cutoff) continue;
      entry.buckets.delete(bucket);
      const month = monthOf(bucketStart(bucket));
      let archived = cache.archive.get(month);
      if (archived === undefined) { archived = new Map(); cache.archive.set(month, archived); }
      mergeSeries(archived, series);
    }
  }
}

/** Whole-corpus totals: every cached session plus everything already archived. */
export function cacheTotals(cache: UsageCache): { tokens: number; requests: number } {
  let tokens = 0;
  let requests = 0;
  const add = (totals: SeriesTotals): void => { tokens += totalTokens(totals); requests += totals.requests; };
  for (const entry of cache.sessions.values()) for (const series of entry.buckets.values()) for (const totals of series.values()) add(totals);
  for (const series of cache.archive.values()) for (const totals of series.values()) add(totals);
  return { tokens, requests };
}

/** Where the aggregate cache lives on disk. */
export interface UsageCacheStore {
  read(): Promise<string | undefined>;
  write(text: string): Promise<void>;
}

/** One JSON file per profile, written through a temporary sibling and renamed into place. */
export function createFileCacheStore(path: string): UsageCacheStore {
  return {
    async read(): Promise<string | undefined> {
      try {
        return await readFile(path, 'utf8');
      } catch {
        return undefined;
      }
    },
    async write(text: string): Promise<void> {
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, text, 'utf8');
      await rename(temporary, path);
    },
  };
}
