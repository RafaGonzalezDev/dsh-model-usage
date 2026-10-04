/**
 * The corpus aggregate: one incremental pass over every session log in the profile.
 *
 * Sessions are re-read only when their persistence revision moved, so a warm cache answers a
 * panel request without touching a log. Live sessions that are not persisted yet are re-read on
 * every pass and stay out of the cache file.
 */
import { canonicalClientTimeZone } from '@deepseek-ai/dsh-util-time';
import { dayKey, dayKeysFor, hostZone } from './calendar.ts';
import { cacheTotals, compactArchive, emptyCache, parseCache, serializeCache, type UsageCache, type UsageCacheStore } from './cache.ts';
import type { UsageCell, UsageQuery, UsageSeries, UsageSeriesTotals, UsageSnapshot } from './contracts.ts';
import { throwIfAborted } from './errors.ts';
import { bucketStart, emptyTotals, foldSession, mergeSeries, splitSeriesId, totalTokens, type SeriesTotals, type UsageEventLike } from './fold.ts';
import type { UsageSnapshotProvider } from './service.ts';

/** The slice of `ctx.sessionQuery` the aggregate needs. */
export interface UsageCorpusPort {
  listSessions(signal?: AbortSignal): Promise<readonly { header: { id: string } }[]>;
  readSession(sessionId: string): Promise<{ events: readonly UsageEventLike[] }>;
}

/** The slice of `ctx.sessionPersistence` the aggregate needs. */
export interface UsagePersistencePort {
  list(): Promise<readonly {
    header: { id: string };
    revision: string;
    eventCount?: number;
    sizeBytes?: number;
  }[]>;
}

export interface UsageAggregatorOptions {
  corpus: UsageCorpusPort;
  persistence: UsagePersistencePort;
  store: UsageCacheStore;
  /** Current selector catalog; optional so unavailable providers never hide historical usage. */
  listModels?: (provider: string) => Promise<readonly { provider: string; id: string; name: string }[]>;
  /** Reference clock; injectable so tests can place a corpus in time. */
  now?: () => number;
  /** Concurrent persisted-log reads in one pass. */
  readConcurrency?: number;
  /** Days of per-session detail kept before buckets move to the monthly archive. */
  retentionDays?: number;
}

/** Coverage of the pass that produced the cache. */
interface Coverage {
  sessions: number;
  live: number;
  skipped: number;
}

/** Signature of one persisted session: its revision plus the cheap counts the backend offers. */
function signatureOf(snapshot: { revision: string; eventCount?: number; sizeBytes?: number }): string {
  return `${snapshot.revision}:${snapshot.eventCount ?? '?'}:${snapshot.sizeBytes ?? '?'}`;
}

export class UsageAggregator implements UsageSnapshotProvider {
  private readonly corpus: UsageCorpusPort;
  private readonly persistence: UsagePersistencePort;
  private readonly store: UsageCacheStore;
  private readonly listModels: UsageAggregatorOptions['listModels'];
  private readonly now: () => number;
  private readonly readConcurrency: number;
  private readonly retentionDays: number;
  private cache: UsageCache | undefined;
  private building: Promise<void> | undefined;
  private dirty = false;
  private coverage: Coverage = { sessions: 0, live: 0, skipped: 0 };

  constructor(options: UsageAggregatorOptions) {
    this.corpus = options.corpus;
    this.persistence = options.persistence;
    this.store = options.store;
    this.listModels = options.listModels;
    this.now = options.now ?? (() => Date.now());
    this.readConcurrency = Math.max(1, options.readConcurrency ?? 4);
    this.retentionDays = Math.max(1, options.retentionDays ?? 400);
  }

  /** Re-inspect the corpus; concurrent callers share one pass. */
  async refresh(force = false, signal?: AbortSignal): Promise<void> {
    if (this.building !== undefined) return this.building;
    const run = this.rebuild(force, signal).finally(() => {
      if (this.building === run) this.building = undefined;
    });
    this.building = run;
    return run;
  }

  async snapshot(query: UsageQuery, signal: AbortSignal): Promise<UsageSnapshot> {
    throwIfAborted(signal);
    await this.refresh(query.force === true, signal);
    throwIfAborted(signal);
    const snapshot = this.project(query);
    if (this.listModels) {
      await Promise.all([...new Set(snapshot.series.map(series => series.provider))].map(async provider => {
        try {
          const models = await this.listModels!(provider);
          for (const series of snapshot.series) {
            if (series.provider !== provider) continue;
            const model = models.find(model => model.provider === provider && model.id === series.model);
            if (model && typeof model.name === 'string' && model.name.trim().length > 0) series.name = model.name;
          }
        } catch {
          // Removed providers and transient catalog failures retain the durable model id.
        }
      }));
    }
    throwIfAborted(signal);
    return snapshot;
  }

  private async load(): Promise<UsageCache> {
    if (this.cache === undefined) {
      let text: string | undefined;
      try {
        text = await this.store.read();
      } catch {
        text = undefined;
      }
      this.cache = parseCache(text) ?? emptyCache();
    }
    return this.cache;
  }

  /** Session id to signature; an unavailable backend leaves every session unsigned. */
  private async signatures(): Promise<Map<string, string>> {
    const signatures = new Map<string, string>();
    let snapshots: Awaited<ReturnType<UsagePersistencePort['list']>>;
    try {
      snapshots = await this.persistence.list();
    } catch {
      return signatures;
    }
    for (const snapshot of snapshots) signatures.set(snapshot.header.id, signatureOf(snapshot));
    return signatures;
  }

  private async rebuild(force: boolean, signal?: AbortSignal): Promise<void> {
    const cache = await this.load();
    const records = await this.corpus.listSessions(signal);
    const signatures = await this.signatures();
    const seen = new Set<string>();
    const pending: string[] = [];
    let live = 0;
    for (const record of records) {
      const id = record.header.id;
      seen.add(id);
      const signature = force ? undefined : signatures.get(id);
      if (signature === undefined) live++;
      const cached = cache.sessions.get(id);
      if (signature !== undefined && cached !== undefined && cached.sig === signature) continue;
      pending.push(id);
    }
    for (const id of [...cache.sessions.keys()]) {
      if (seen.has(id)) continue;
      cache.sessions.delete(id);
      this.dirty = true;
    }
    const skipped = await this.foldAll(cache, pending, signatures, signal);
    if (pending.length > 0) this.dirty = true;
    compactArchive(cache, this.now(), this.retentionDays, instant => dayKey(instant, hostZone()).slice(0, 7));
    this.coverage = { sessions: records.length, live, skipped };
    await this.persist();
  }

  /** Fold every pending session, bounded by `readConcurrency`; one failure never stops the pass. */
  private async foldAll(cache: UsageCache, ids: readonly string[], signatures: Map<string, string>, signal?: AbortSignal): Promise<number> {
    let skipped = 0;
    const queue = [...ids];
    const worker = async (): Promise<void> => {
      while (queue.length > 0) {
        if (signal?.aborted) return;
        const id = queue.shift();
        if (id === undefined) return;
        try {
          const snapshot = await this.corpus.readSession(id);
          cache.sessions.set(id, { sig: signatures.get(id) ?? '', buckets: foldSession(snapshot.events).buckets });
        } catch {
          skipped++;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.readConcurrency, queue.length) }, worker));
    return skipped;
  }

  private async persist(): Promise<void> {
    if (!this.dirty || this.cache === undefined) return;
    this.dirty = false;
    try {
      await this.store.write(serializeCache(this.cache, this.now()));
    } catch {
      this.dirty = true;
    }
  }

  /** Shape the cached aggregate into the requested window and zone. */
  private project(query: UsageQuery): UsageSnapshot {
    const cache = this.cache ?? emptyCache();
    const requested = query.zone;
    const canonical = requested === undefined ? undefined : canonicalClientTimeZone(requested);
    const zone = canonical ?? hostZone();
    const days = dayKeysFor(this.now(), query.rangeDays, zone);
    const dayIndex = new Map<string, number>();
    days.forEach((key, index) => dayIndex.set(key, index));

    const weights = new Map<string, SeriesTotals>();
    for (const entry of cache.sessions.values()) {
      for (const [bucket, series] of entry.buckets) {
        if (!dayIndex.has(dayKey(bucketStart(bucket), zone))) continue;
        mergeSeries(weights, series);
      }
    }
    const ordered = [...weights.keys()].sort((a, b) => totalTokens(weights.get(b) ?? emptyTotals()) - totalTokens(weights.get(a) ?? emptyTotals()) || a.localeCompare(b));
    const series: UsageSeries[] = ordered.map(id => ({ id, ...splitSeriesId(id) }));
    const seriesTotals: UsageSeriesTotals[] = ordered.map((id, index) => {
      const totals = weights.get(id) ?? emptyTotals();
      return { series: index, ...totals };
    });
    const position = new Map<string, number>();
    ordered.forEach((id, index) => position.set(id, index));

    const cells = new Map<string, UsageCell>();
    for (const entry of cache.sessions.values()) {
      for (const [bucket, bucketSeries] of entry.buckets) {
        const day = dayIndex.get(dayKey(bucketStart(bucket), zone));
        if (day === undefined) continue;
        for (const [id, totals] of bucketSeries) {
          const index = position.get(id);
          if (index === undefined) continue;
          const tokens = totalTokens(totals);
          if (tokens === 0 && totals.requests === 0) continue;
          const key = `${day}:${index}`;
          const cell = cells.get(key);
          if (cell === undefined) cells.set(key, { day, series: index, tokens, requests: totals.requests });
          else { cell.tokens += tokens; cell.requests += totals.requests; }
        }
      }
    }
    return {
      generatedAt: this.now(),
      zone,
      zoneFallback: requested !== undefined && canonical === undefined,
      from: days[0] ?? '',
      to: days[days.length - 1] ?? '',
      days,
      series,
      cells: [...cells.values()].sort((a, b) => a.day - b.day || a.series - b.series),
      seriesTotals,
      allTime: cacheTotals(cache),
      scanned: { ...this.coverage },
    };
  }
}
