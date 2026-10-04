import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CACHE_VERSION, cacheTotals, compactArchive, emptyCache, parseCache, serializeCache,
  type UsageCache,
} from '../packages/plugin/src/cache.ts';
import { bucketOf, emptyTotals, seriesId, type BucketTotals, type SeriesTotals } from '../packages/plugin/src/fold.ts';

const ID = seriesId('chatgpt-plan', 'gpt-6.1-sol');

function totals(partial: Partial<SeriesTotals>): SeriesTotals {
  return { ...emptyTotals(), ...partial };
}

function cacheWith(bucket: number, value: SeriesTotals, sig = 'rev-1:10:2048'): UsageCache {
  const cache = emptyCache();
  const buckets: BucketTotals = new Map([[bucket, new Map([[ID, value]])]]);
  cache.sessions.set('session-a', { sig, buckets });
  return cache;
}

test('an absent, corrupt or foreign cache is discarded instead of trusted', () => {
  assert.equal(parseCache(undefined), undefined);
  assert.equal(parseCache(''), undefined);
  assert.equal(parseCache('{ not json'), undefined);
  assert.equal(parseCache(JSON.stringify({ version: CACHE_VERSION + 1, sessions: {} })), undefined);
  assert.equal(parseCache(JSON.stringify({ version: 1, sessions: {} })), undefined);
  assert.deepEqual(parseCache(JSON.stringify({ version: CACHE_VERSION })), emptyCache());
});

test('the cache round-trips buckets and their signatures', () => {
  const time = Date.UTC(2026, 9, 4, 12, 0, 0);
  const cache = cacheWith(bucketOf(time), totals({ input: 100, output: 20, cacheRead: 40, reasoning: 5, requests: 3 }));
  const restored = parseCache(serializeCache(cache, time));
  assert.ok(restored);
  const entry = restored.sessions.get('session-a');
  assert.equal(entry?.sig, 'rev-1:10:2048');
  assert.deepEqual(entry?.buckets.get(bucketOf(time))?.get(ID), { input: 100, output: 20, cacheRead: 40, reasoning: 5, requests: 3 });
});

test('malformed entries are dropped without discarding the rest of the file', () => {
  const time = Date.UTC(2026, 9, 4, 12, 0, 0);
  const bucket = bucketOf(time);
  const text = JSON.stringify({
    version: CACHE_VERSION,
    sessions: {
      good: { sig: 'rev:1:1', buckets: { [bucket]: { [ID]: [1, 2, 0, 0, 1] } } },
      unsigned: { sig: '', buckets: { [bucket]: { [ID]: [1, 2, 0, 0, 1] } } },
      malformed: { sig: 'rev:1:1', buckets: { [bucket]: { [ID]: [1, 2] } } },
      broken: { sig: 'rev:1:1', buckets: 'nope' },
    },
  });
  const restored = parseCache(text);
  assert.deepEqual([...(restored?.sessions.keys() ?? [])], ['good']);
});

test('sessions without a signature stay in memory and never reach the file', () => {
  const time = Date.UTC(2026, 9, 4, 12, 0, 0);
  const cache = cacheWith(bucketOf(time), totals({ input: 5 }), '');
  const restored = parseCache(serializeCache(cache, time));
  assert.equal(restored?.sessions.size, 0);
  assert.equal(cacheTotals(cache).tokens, 5, 'the unsaved contribution still counts locally');
});

test('buckets past the retention window move to the monthly archive', () => {
  const old = Date.UTC(2024, 0, 15, 12, 0, 0);
  const recent = Date.UTC(2026, 9, 4, 12, 0, 0);
  const cache = emptyCache();
  cache.sessions.set('session-a', {
    sig: 'rev:1:1',
    buckets: new Map([
      [bucketOf(old), new Map([[ID, totals({ input: 10, requests: 1 })]])],
      [bucketOf(recent), new Map([[ID, totals({ input: 90, requests: 2 })]])],
    ]),
  });
  compactArchive(cache, recent, 400, instant => new Date(instant).toISOString().slice(0, 7));
  const entry = cache.sessions.get('session-a');
  assert.deepEqual([...(entry?.buckets.keys() ?? [])], [bucketOf(recent)], 'only the retained bucket stays per-session');
  assert.deepEqual(cache.archive.get('2024-01')?.get(ID), { input: 10, output: 0, cacheRead: 0, reasoning: 0, requests: 1 });
  assert.equal(cacheTotals(cache).tokens, 100, 'archiving never loses a token');
  assert.equal(cacheTotals(cache).requests, 3);
});

test('compaction is idempotent: a second pass moves nothing and keeps the totals', () => {
  const old = Date.UTC(2024, 0, 15, 12, 0, 0);
  const recent = Date.UTC(2026, 9, 4, 12, 0, 0);
  const cache = cacheWith(bucketOf(old), totals({ input: 10, requests: 1 }));
  const monthOf = (instant: number): string => new Date(instant).toISOString().slice(0, 7);
  compactArchive(cache, recent, 400, monthOf);
  const first = cacheTotals(cache);
  compactArchive(cache, recent, 400, monthOf);
  assert.deepEqual(cacheTotals(cache), first);
  assert.equal(cache.archive.size, 1);
});

test('reasoning coverage survives serialization and monthly archive merges', () => {
  const old = Date.UTC(2024, 0, 15, 12);
  const now = Date.UTC(2026, 9, 4, 12);
  const cache = cacheWith(bucketOf(old), totals({ reasoning: 7, reasoningReported: 2, requests: 3 }));
  cache.archive.set('2024-01', new Map([[ID, totals({ reasoningReported: 1, requests: 2 })]]));
  const restored = parseCache(serializeCache(cache, now))!;
  assert.deepEqual(restored, cache);
  compactArchive(restored, now, 400, () => '2024-01');
  const archived = restored.archive.get('2024-01')!.get(ID)!;
  assert.equal(archived.reasoningReported, 3);
  assert.equal(archived.reasoning, 7);
  assert.equal(archived.requests, 5);
  assert.deepEqual(parseCache(serializeCache(restored, now))!.archive, restored.archive);
});

test('cache rejects invalid reasoning coverage counts', () => {
  for (const reported of [-1, 0.5, 2, null, '1']) {
    const cache = parseCache(JSON.stringify({ version: CACHE_VERSION, archive: { '2024-01': { [ID]: [0, 0, 0, 0, 1, reported] } } }));
    assert.equal(cache?.archive.size, 0);
  }
});

test('effort round trips independently of token coverage and rejects malformed histograms', () => {
  const cache = cacheWith(1, totals({ requests: 3, reasoningEfforts: [{ effort: 'high', requests: 2 }] }));
  assert.deepEqual(parseCache(serializeCache(cache, 0)), cache);
  compactArchive(cache, Date.UTC(2026, 0), 400, () => '2024-01');
  assert.deepEqual(parseCache(serializeCache(cache, 0))!.archive, cache.archive);
  for (const efforts of [[{ effort: '', requests: 1 }], [{ effort: 'high', requests: 2 }],
    [{ effort: 'high', requests: 0 }], [{ effort: 'high', requests: 0.5 }],
    [{ effort: 'high', requests: 1 }, { effort: 'high', requests: 1 }], 'high']) {
    const restored = parseCache(JSON.stringify({ version: CACHE_VERSION, archive: { '2024-01': { [ID]: [0, 0, 0, 0, 1, null, efforts] } } }));
    assert.equal(restored?.archive.size, 0);
  }
  assert.equal(parseCache(JSON.stringify({ version: 2, sessions: {} })), undefined, 'older caches must refold effort');
});

test('whole-corpus totals add the archive to the live sessions', () => {
  const cache = cacheWith(bucketOf(Date.UTC(2026, 9, 4, 12, 0, 0)), totals({ input: 100, output: 20, requests: 2 }));
  cache.archive.set('2024-01', new Map([[ID, totals({ input: 1_000, output: 500, requests: 7 })]]));
  assert.deepEqual(cacheTotals(cache), { tokens: 1_620, requests: 9 });
});
