import assert from 'node:assert/strict';
import test from 'node:test';
import { UsageAggregator } from '../packages/plugin/src/aggregator.ts';
import type { UsageQuery } from '../packages/plugin/src/contracts.ts';
import { dayKey } from '../packages/plugin/src/calendar.ts';
import { FakeCorpus, FakePersistence, MemoryCacheStore, compaction, step } from './helpers.ts';

/** 2026-10-04T14:00 in Europe/Madrid, the reference "today" of these tests. */
const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);
const SIGNAL = new AbortController().signal;

function fixture(): { aggregator: UsageAggregator; corpus: FakeCorpus; persistence: FakePersistence; store: MemoryCacheStore } {
  const corpus = new FakeCorpus();
  const persistence = new FakePersistence();
  const store = new MemoryCacheStore();
  const aggregator = new UsageAggregator({ corpus, persistence, store, now: () => NOW, readConcurrency: 2 });
  return { aggregator, corpus, persistence, store };
}

function query(overrides: Partial<UsageQuery> = {}): UsageQuery {
  return { rangeDays: 30, zone: 'Europe/Madrid', ...overrides };
}

test('a cold pass reads every session once and answers the window', async () => {
  const { aggregator, corpus, persistence, store } = fixture();
  corpus.add('session-a', [step(NOW - 3_600_000)]);
  corpus.add('session-b', [step(NOW - 3_600_000, 'opencode-go', 'deepseek-v4.1-flash'), compaction(NOW - 7_200_000)]);
  persistence.set('session-a', 'rev-1', { eventCount: 1, sizeBytes: 100 });
  persistence.set('session-b', 'rev-1', { eventCount: 2, sizeBytes: 200 });

  const snapshot = await aggregator.snapshot(query(), SIGNAL);

  assert.equal(snapshot.days.length, 30);
  assert.equal(snapshot.from, '2026-09-05');
  assert.equal(snapshot.to, '2026-10-04');
  assert.equal(snapshot.zone, 'Europe/Madrid');
  assert.equal(snapshot.zoneFallback, false);
  assert.deepEqual([...corpus.reads].sort(), ['session-a', 'session-b']);
  assert.deepEqual(snapshot.scanned, { sessions: 2, live: 0, skipped: 0 });
  assert.equal(snapshot.series.length, 3);
  assert.deepEqual(snapshot.series.map(entry => entry.model).sort(), ['deepseek-v4.1-flash', 'gpt-6-astra', 'gpt-6.1-sol']);
  const day = snapshot.days.indexOf('2026-10-04');
  const cells = snapshot.cells.filter(cell => cell.day === day);
  assert.equal(cells.reduce((sum, cell) => sum + cell.tokens, 0), 120 + 120 + 1_100);
  assert.equal(cells.reduce((sum, cell) => sum + cell.requests, 0), 3);
  assert.equal(store.writes, 1, 'the first pass persists the cache');
});

test('a warm pass with unchanged revisions reads no log at all', async () => {
  const { aggregator, corpus, persistence } = fixture();
  corpus.add('session-a', [step(NOW - 3_600_000)]);
  persistence.set('session-a', 'rev-1', { eventCount: 1, sizeBytes: 100 });
  await aggregator.snapshot(query(), SIGNAL);
  const readsAfterFirst = corpus.reads.length;
  const second = await aggregator.snapshot(query(), SIGNAL);
  assert.equal(corpus.reads.length, readsAfterFirst, 'nothing was re-read');
  assert.equal(second.allTime.tokens, 120);
});

test('only the session whose revision moved is re-read', async () => {
  const { aggregator, corpus, persistence } = fixture();
  corpus.add('session-a', [step(NOW - 3_600_000)]);
  corpus.add('session-b', [step(NOW - 3_600_000)]);
  persistence.set('session-a', 'rev-1', { eventCount: 1, sizeBytes: 100 });
  persistence.set('session-b', 'rev-1', { eventCount: 1, sizeBytes: 100 });
  await aggregator.snapshot(query(), SIGNAL);
  corpus.reads.length = 0;

  corpus.add('session-b', [step(NOW - 3_600_000), step(NOW - 3_500_000)]);
  persistence.set('session-b', 'rev-2', { eventCount: 2, sizeBytes: 200 });

  const snapshot = await aggregator.snapshot(query(), SIGNAL);
  assert.deepEqual(corpus.reads, ['session-b']);
  assert.equal(snapshot.allTime.requests, 3, 'the contribution replaced itself instead of doubling');
});

test('a session that disappeared takes its rows with it', async () => {
  const { aggregator, corpus, persistence } = fixture();
  corpus.add('session-a', [step(NOW - 3_600_000)]);
  corpus.add('session-b', [step(NOW - 3_600_000)]);
  persistence.set('session-a', 'rev-1', { eventCount: 1, sizeBytes: 100 });
  persistence.set('session-b', 'rev-1', { eventCount: 1, sizeBytes: 100 });
  await aggregator.snapshot(query(), SIGNAL);

  corpus.sessions.delete('session-b');
  persistence.clear('session-b');
  const snapshot = await aggregator.snapshot(query(), SIGNAL);
  assert.equal(snapshot.scanned.sessions, 1);
  assert.equal(snapshot.scanned.live, 0);
  assert.equal(snapshot.allTime.requests, 1);
});

test('a live session with no persisted revision is re-read on every pass', async () => {
  const { aggregator, corpus, persistence } = fixture();
  corpus.add('session-live', [step(NOW - 3_600_000)]);
  corpus.add('session-cold', [step(NOW - 3_600_000)]);
  persistence.set('session-cold', 'rev-1', { eventCount: 1, sizeBytes: 100 });
  await aggregator.snapshot(query(), SIGNAL);
  corpus.reads.length = 0;
  const snapshot = await aggregator.snapshot(query(), SIGNAL);
  assert.deepEqual(corpus.reads, ['session-live']);
  assert.equal(snapshot.scanned.live, 1);
  assert.equal(snapshot.allTime.requests, 2, 'the live session is counted once, not twice');
});

test('one unreadable log never hides the rest of the corpus', async () => {
  const { aggregator, corpus, persistence } = fixture();
  corpus.add('session-a', [step(NOW - 3_600_000)]);
  corpus.add('session-b', [step(NOW - 3_600_000)]);
  persistence.set('session-a', 'rev-1', { eventCount: 1, sizeBytes: 100 });
  persistence.set('session-b', 'rev-1', { eventCount: 1, sizeBytes: 100 });
  corpus.failOn.add('session-b');

  const snapshot = await aggregator.snapshot(query(), SIGNAL);
  assert.deepEqual(snapshot.scanned, { sessions: 2, live: 0, skipped: 1 });
  assert.equal(snapshot.allTime.requests, 1);
});

test('an unavailable persistence backend degrades to re-reading, never to failing', async () => {
  const { aggregator, corpus, persistence } = fixture();
  corpus.add('session-a', [step(NOW - 3_600_000)]);
  persistence.available = false;
  const first = await aggregator.snapshot(query(), SIGNAL);
  assert.equal(first.scanned.live, 1);
  const reads = corpus.reads.length;
  await aggregator.snapshot(query(), SIGNAL);
  assert.equal(corpus.reads.length, reads * 2, 'without signatures every pass re-reads');
});

test('force re-reads the whole corpus even when nothing moved', async () => {
  const { aggregator, corpus, persistence } = fixture();
  corpus.add('session-a', [step(NOW - 3_600_000)]);
  persistence.set('session-a', 'rev-1', { eventCount: 1, sizeBytes: 100 });
  await aggregator.snapshot(query(), SIGNAL);
  corpus.reads.length = 0;
  await aggregator.snapshot(query({ force: true }), SIGNAL);
  assert.deepEqual(corpus.reads, ['session-a']);
});

test('concurrent requests share one pass over the corpus', async () => {
  const { aggregator, corpus, persistence } = fixture();
  corpus.add('session-a', [step(NOW - 3_600_000)]);
  corpus.add('session-b', [step(NOW - 3_600_000)]);
  persistence.set('session-a', 'rev-1', { eventCount: 1, sizeBytes: 100 });
  persistence.set('session-b', 'rev-1', { eventCount: 1, sizeBytes: 100 });
  const [first, second] = await Promise.all([aggregator.snapshot(query(), SIGNAL), aggregator.snapshot(query(), SIGNAL)]);
  assert.equal(corpus.listCalls, 1);
  assert.equal(corpus.reads.length, 2);
  assert.deepEqual(first.allTime, second.allTime);
});

test('the window clips the heatmap while the historical totals keep counting', async () => {
  const { aggregator, corpus, persistence } = fixture();
  corpus.add('session-a', [step(NOW - 100 * 86_400_000), step(NOW - 3_600_000)]);
  persistence.set('session-a', 'rev-1', { eventCount: 2, sizeBytes: 200 });
  const snapshot = await aggregator.snapshot(query({ rangeDays: 30 }), SIGNAL);
  assert.equal(snapshot.cells.reduce((sum, cell) => sum + cell.requests, 0), 1, 'only the in-window step is a cell');
  assert.equal(snapshot.allTime.requests, 2, 'the older step still counts historically');
});

test('the same corpus lands on different days in different zones', async () => {
  const { aggregator, corpus, persistence } = fixture();
  const late = Date.UTC(2026, 9, 4, 20, 0, 0); // 2026-10-05T01:45 in Asia/Kathmandu
  corpus.add('session-a', [step(late)]);
  persistence.set('session-a', 'rev-1', { eventCount: 1, sizeBytes: 100 });

  const utc = await aggregator.snapshot(query({ zone: 'UTC' }), SIGNAL);
  assert.deepEqual(utc.cells.map(cell => utc.days[cell.day]), ['2026-10-04']);

  const kathmandu = await aggregator.snapshot(query({ zone: 'Asia/Kathmandu' }), SIGNAL);
  assert.deepEqual(kathmandu.cells, [], 'the same step falls past the end of the Kathmandu window');
  assert.equal(kathmandu.allTime.requests, 1);
});

test('an unusable zone is refused and answered by the host zone instead', async () => {
  const { aggregator, corpus, persistence } = fixture();
  corpus.add('session-a', [step(NOW - 3_600_000)]);
  persistence.set('session-a', 'rev-1', { eventCount: 1, sizeBytes: 100 });
  const snapshot = await aggregator.snapshot(query({ zone: 'Mars/Olympus' }), SIGNAL);
  assert.equal(snapshot.zoneFallback, true);
  assert.ok(snapshot.zone.length > 0);
  assert.equal(snapshot.days.length, 30);
});

test('a corrupt cache file is rebuilt from the corpus', async () => {
  const { aggregator, corpus, persistence, store } = fixture();
  store.text = '{ this is not json';
  corpus.add('session-a', [step(NOW - 3_600_000)]);
  persistence.set('session-a', 'rev-1', { eventCount: 1, sizeBytes: 100 });
  const snapshot = await aggregator.snapshot(query(), SIGNAL);
  assert.equal(snapshot.allTime.requests, 1);
  assert.equal(store.writes, 1);
});

test('a cache written by a first run answers the second run without reading logs', async () => {
  const first = fixture();
  first.corpus.add('session-a', [step(NOW - 3_600_000)]);
  first.persistence.set('session-a', 'rev-1', { eventCount: 1, sizeBytes: 100 });
  await first.aggregator.snapshot(query(), SIGNAL);

  const corpus = new FakeCorpus();
  const persistence = new FakePersistence();
  const store = new MemoryCacheStore();
  store.text = first.store.text;
  corpus.add('session-a', [step(NOW - 3_600_000)]);
  persistence.set('session-a', 'rev-1', { eventCount: 1, sizeBytes: 100 });
  const aggregator = new UsageAggregator({ corpus, persistence, store, now: () => NOW });
  const snapshot = await aggregator.snapshot(query(), SIGNAL);

  assert.deepEqual(corpus.reads, [], 'the persisted cache answered the request');
  assert.equal(snapshot.allTime.requests, 1);
  assert.equal(store.writes, 0, 'an unchanged pass writes nothing');
});

test('window reasoning coverage distinguishes absence, zero and partial across sessions and cache', async () => {
  const { aggregator, corpus, persistence, store } = fixture();
  corpus.add('a', [
    step(NOW, 'p', 'absent', {}),
    step(NOW, 'p', 'zero', { reasoningTokens: 0 }),
    step(NOW, 'p', 'partial', { reasoningTokens: 0 }),
    step(NOW - 100 * 86_400_000, 'p', 'partial', { reasoningTokens: 99 }),
  ]);
  corpus.add('b', [
    step(NOW - 3_600_000, 'p', 'partial', {}),
    step(NOW - 7_200_000, 'p', 'partial', { reasoningTokens: 7 }),
  ]);
  persistence.set('a', 'rev-1');
  persistence.set('b', 'rev-1');
  const first = await aggregator.snapshot(query(), SIGNAL);
  const byModel = new Map(first.series.map((series, index) => [series.model, first.seriesTotals[index]!]));
  assert.equal(byModel.get('absent')!.reasoningReported, undefined);
  assert.equal(byModel.get('zero')!.reasoningReported, 1);
  assert.equal(byModel.get('zero')!.reasoning, 0);
  assert.equal(byModel.get('partial')!.reasoningReported, 2);
  assert.equal(byModel.get('partial')!.requests, 3);
  assert.equal(byModel.get('partial')!.reasoning, 7);
  corpus.reads.length = 0;
  const restored = new UsageAggregator({ corpus, persistence, store, now: () => NOW });
  assert.deepEqual((await restored.snapshot(query(), SIGNAL)).seriesTotals, first.seriesTotals);
  assert.deepEqual(corpus.reads, []);
});

test('catalog names use exact provider/model matches, refresh on warm cache and tolerate failures', async () => {
  const { corpus, persistence, store } = fixture();
  corpus.add('a', [step(NOW, 'p', 'm'), step(NOW, 'q', 'm'), step(NOW, 'p', 'gone')]);
  persistence.set('a', 'rev');
  let name = 'Official model';
  const calls: string[] = [];
  const aggregator = new UsageAggregator({ corpus, persistence, store, now: () => NOW, listModels: async provider => {
    calls.push(provider);
    if (provider === 'q') throw Error('provider unavailable');
    return [{ provider: 'p', id: 'm', name }, { provider: 'q', id: 'gone', name: 'Wrong provider' }];
  } });
  const first = await aggregator.snapshot(query(), SIGNAL);
  assert.equal(first.series.find(row => row.provider === 'p' && row.model === 'm')!.name, name);
  assert.ok(first.series.filter(row => row.model === 'gone' || row.provider === 'q').every(row => row.name === undefined));
  assert.deepEqual(calls.sort(), ['p', 'q']);
  name = 'Renamed model';
  corpus.reads.length = 0;
  const second = await aggregator.snapshot(query(), SIGNAL);
  assert.equal(second.series.find(row => row.provider === 'p' && row.model === 'm')!.name, name);
  assert.deepEqual(corpus.reads, []);
  assert.deepEqual(first.allTime, second.allTime);
});

test('effort merges across sessions and survives a persisted warm window', async () => {
  const { aggregator, corpus, persistence, store } = fixture();
  const header = { type: 'request/header', data: { header: { config: { provider: 'p', model: 'm', reasoningEffort: 'high' } } } };
  corpus.add('a', [header, step(NOW, 'p', 'm'), step(NOW - 100 * 86_400_000, 'p', 'm')]);
  corpus.add('b', [header, step(NOW, 'p', 'm'), compaction(NOW, 'p', 'm')]);
  persistence.set('a', 'rev'); persistence.set('b', 'rev');
  const first = await aggregator.snapshot(query(), SIGNAL);
  assert.deepEqual(first.seriesTotals[0]!.reasoningEfforts, [{ effort: 'high', requests: 2 }]);
  assert.equal(first.seriesTotals[0]!.requests, 3);
  const restored = new UsageAggregator({ corpus, persistence, store, now: () => NOW });
  assert.deepEqual((await restored.snapshot(query(), SIGNAL)).seriesTotals, first.seriesTotals);
  assert.deepEqual((await restored.snapshot(query(), SIGNAL)).seriesTotals, first.seriesTotals);
});

test('the reported zone is the one the day keys were built in', async () => {
  const { aggregator, corpus, persistence } = fixture();
  corpus.add('session-a', [step(Date.UTC(2026, 9, 4, 23, 30, 0))]);
  persistence.set('session-a', 'rev-1', { eventCount: 1, sizeBytes: 100 });
  const snapshot = await aggregator.snapshot(query({ zone: 'Pacific/Auckland' }), SIGNAL);
  const expected = dayKey(Date.UTC(2026, 9, 4, 23, 30, 0), 'Pacific/Auckland');
  assert.ok(snapshot.days.includes(expected));
  assert.deepEqual(snapshot.cells.map(cell => snapshot.days[cell.day]), [expected]);
});
