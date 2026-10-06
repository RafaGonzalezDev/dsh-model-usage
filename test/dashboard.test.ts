import assert from 'node:assert/strict';
import test from 'node:test';
import type { UsageSnapshot } from '../packages/plugin/src/contracts.ts';
import { deriveRecent, deriveUsage, groupByProvider } from '../packages/plugin/src/client/derive.ts';
import { summarizeEffort } from '../packages/plugin/src/client/effort.ts';
import { createUsageHub, type UsageState } from '../packages/plugin/src/client/state.ts';
import { formatCount, formatDay, formatShare, formatTokens } from '../packages/plugin/src/client/format.ts';

const DAYS = ['2026-10-01', '2026-10-02', '2026-10-03'];

function snapshot(): UsageSnapshot {
  return {
    generatedAt: 1_791_000_000_000,
    zone: 'UTC',
    zoneFallback: false,
    from: DAYS[0] ?? '',
    to: DAYS[2] ?? '',
    days: DAYS,
    series: [
      { id: 'a\u0000m1', provider: 'a', model: 'm1' },
      { id: 'b\u0000m2', provider: 'b', model: 'm2' },
    ],
    cells: [
      { day: 0, series: 0, tokens: 100, requests: 1 },
      { day: 2, series: 0, tokens: 300, requests: 2 },
      { day: 1, series: 1, tokens: 50, requests: 1 },
    ],
    seriesTotals: [
      { series: 0, input: 260, output: 100, cacheRead: 40, cacheWrite: 0, reasoning: 5, requests: 3 },
      { series: 1, input: 40, output: 10, cacheRead: 0, cacheWrite: 0, reasoning: 0, requests: 1 },
    ],
    allTime: { tokens: 999, requests: 9 },
    scanned: { sessions: 2, live: 0, skipped: 0 },
  };
}

const ALL = '';

test('an unfiltered window keeps every series and sums both metrics per day', () => {
  const view = deriveUsage(snapshot(), ALL, 'tokens');
  assert.equal(view.rows.length, 2);
  assert.deepEqual(view.dayTokens, [100, 50, 300]);
  assert.deepEqual(view.dayRequests, [1, 1, 2]);
  assert.deepEqual(view.dayValues, [100, 50, 300]);
  assert.deepEqual(view.totals, {
    tokens: 450,
    requests: 4,
    activeDays: 3,
    peak: { day: '2026-10-03', value: 300 },
    models: 2,
    providers: 2,
  });
});

test('a text query drops the other series from the grid and the totals', () => {
  const view = deriveUsage(snapshot(), 'a', 'tokens');
  assert.deepEqual(view.rows.map(row => row.series.model), ['m1']);
  assert.deepEqual(view.dayTokens, [100, 0, 300]);
  assert.equal(view.totals.tokens, 400);
  assert.equal(view.totals.activeDays, 2);
  assert.equal(view.totals.models, 1);
  assert.equal(view.totals.providers, 1);
});

test('the metric switches the grid and the row order without touching the totals', () => {
  const tokens = deriveUsage(snapshot(), ALL, 'tokens');
  const requests = deriveUsage(snapshot(), ALL, 'requests');
  assert.deepEqual(tokens.rows.map(row => row.series.model), ['m1', 'm2'], 'heaviest by tokens first');
  assert.deepEqual(requests.rows.map(row => row.series.model), ['m1', 'm2']);
  assert.deepEqual(requests.dayValues, [1, 1, 2]);
  assert.deepEqual(requests.totals.peak, { day: '2026-10-03', value: 2 });
  assert.equal(requests.totals.tokens, tokens.totals.tokens);
});

test('a row reports its own token split and the last day it was used', () => {
  const view = deriveUsage(snapshot(), ALL, 'tokens');
  const first = view.rows.find(row => row.series.model === 'm1');
  assert.deepEqual(
    { tokens: first?.tokens, input: first?.input, output: first?.output, cache: first?.cache, cacheRead: first?.cacheRead, cacheWrite: first?.cacheWrite, reasoning: first?.reasoning, last: first?.lastDay },
    { tokens: 400, input: 260, output: 100, cache: 40, cacheRead: 40, cacheWrite: 0, reasoning: 5, last: '2026-10-03' },
  );
});

test('the displayed cache groups both halves while the row keeps them apart', () => {
  const data = snapshot();
  data.seriesTotals[0]!.cacheRead = 30;
  data.seriesTotals[0]!.cacheWrite = 12;
  const row = deriveUsage(data, ALL, 'tokens').rows.find(item => item.series.model === 'm1');
  assert.equal(row?.cache, 42, 'the column the user sees is the sum');
  assert.deepEqual([row?.cacheRead, row?.cacheWrite], [30, 12], 'the split survives for a future cost view');
  assert.equal(row?.tokens, 260 + 100 + 42, 'grouping the display never changes the reconciled total');
  const group = groupByProvider(deriveUsage(data, ALL, 'tokens').rows).find(item => item.provider === 'a');
  assert.equal(group?.cache, 42);
});

test('an older Host without a total is recomputed from the four components', () => {
  const data = snapshot();
  assert.equal(data.seriesTotals[0]!.tokens, undefined, 'the fixture models an older Host');
  const row = deriveUsage(data, ALL, 'tokens').rows.find(item => item.series.model === 'm1');
  assert.equal(row?.tokens, 260 + 100 + 40 + 0);
});

test('the Host total, when present, is authoritative over the components', () => {
  const data = snapshot();
  data.seriesTotals[0]!.tokens = 777;
  const row = deriveUsage(data, ALL, 'tokens').rows.find(item => item.series.model === 'm1');
  assert.equal(row?.tokens, 777);
});

test('rows preserve reasoning coverage, including explicit zero and older snapshots', () => {
  const data = snapshot();
  data.seriesTotals[0]!.reasoningReported = 2;
  data.seriesTotals[1]!.reasoningReported = 1;
  const rows = deriveUsage(data, ALL, 'tokens').rows;
  assert.equal(rows[0]?.reasoningReported, 2);
  assert.equal(rows[1]?.reasoningReported, 1);
  assert.equal(rows[1]?.reasoning, 0);
  assert.equal(deriveUsage(snapshot(), ALL, 'tokens').rows[0]?.reasoningReported, undefined);
});

test('the intensity cut-offs come from the filtered active days only', () => {
  const all = deriveUsage(snapshot(), ALL, 'tokens');
  assert.deepEqual(all.cuts, [50, 100, 300], 'quarter, half and three-quarter of the active days');
  const filtered = deriveUsage(snapshot(), 'b', 'tokens');
  assert.deepEqual(filtered.cuts, [50, 50, 50], 'a single active day paints at full intensity');
  const idle = deriveUsage(snapshot(), 'nobody', 'tokens');
  assert.equal(idle.cuts, undefined);
  assert.equal(idle.totals.peak, undefined);
});

test('a query matches the display name, the model id and the provider, case-insensitively', () => {
  const data = snapshot();
  data.series[0]!.name = 'DeepSeek V4.1 Flash';
  assert.deepEqual(deriveUsage(data, 'flash', 'tokens').rows.map(row => row.series.model), ['m1']);
  assert.deepEqual(deriveUsage(data, 'M2', 'tokens').rows.map(row => row.series.model), ['m2']);
  assert.deepEqual(deriveUsage(data, '  b  ', 'tokens').rows.map(row => row.series.model), ['m2'], 'the query is trimmed');
  assert.deepEqual(deriveUsage(data, 'nothing', 'tokens').rows, []);
  assert.equal(deriveUsage(data, 'nothing', 'tokens').totals.tokens, 0);
  assert.equal(deriveUsage(data, '', 'tokens').rows.length, 2, 'an empty query keeps everything');
});

test('token figures stay compact and never lose the exact count', () => {
  assert.equal(formatTokens(0), '0');
  assert.equal(formatTokens(987), '987');
  assert.equal(formatTokens(12_340), '12.34K');
  assert.equal(formatTokens(448_600_000), '448.60M');
  assert.equal(formatTokens(1_200_000_000), '1.20B');
  assert.equal(formatCount(3_349), '3349');
  assert.equal(formatShare(400, 450), '88.9 %');
  assert.equal(formatShare(1, 0), '0 %');
  assert.equal(formatDay('2026-05-04'), '4 may 2026');
});

/** Two providers, three models: enough to prove grouping and the trailing window. */
function multiSnapshot(): UsageSnapshot {
  return {
    generatedAt: 1_791_000_000_000,
    zone: 'UTC',
    zoneFallback: false,
    from: DAYS[0] ?? '',
    to: DAYS[2] ?? '',
    days: DAYS,
    series: [
      { id: 'a\u0000m1', provider: 'a', model: 'm1' },
      { id: 'a\u0000m2', provider: 'a', model: 'm2' },
      { id: 'b\u0000m3', provider: 'b', model: 'm3' },
    ],
    cells: [
      { day: 0, series: 0, tokens: 100, requests: 2 },
      { day: 1, series: 1, tokens: 50, requests: 1 },
      { day: 2, series: 0, tokens: 10, requests: 1 },
      { day: 2, series: 2, tokens: 400, requests: 4 },
    ],
    seriesTotals: [
      { series: 0, input: 90, output: 10, cacheRead: 5, cacheWrite: 5, reasoning: 2, reasoningReported: 3, requests: 3 },
      { series: 1, input: 50, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, reasoningReported: 1, requests: 1 },
      { series: 2, input: 300, output: 100, cacheRead: 0, cacheWrite: 0, reasoning: 0, requests: 4 },
    ],
    allTime: { tokens: 1_000, requests: 10 },
    scanned: { sessions: 1, live: 0, skipped: 0 },
  };
}

test('provider groups fold every model of a provider and keep their coverage apart', () => {
  const rows = deriveUsage(multiSnapshot(), ALL, 'tokens').rows;
  const groups = groupByProvider(rows);
  assert.deepEqual(groups.map(group => group.provider), ['b', 'a'], 'heaviest provider first');
  const a = groups.find(group => group.provider === 'a');
  assert.deepEqual(
    { tokens: a?.tokens, requests: a?.requests, input: a?.input, output: a?.output, cache: a?.cacheRead, cacheWrite: a?.cacheWrite, reasoning: a?.reasoning, reported: a?.reasoningReported, models: a?.models.length, last: a?.lastDay },
    { tokens: 160, requests: 4, input: 140, output: 10, cache: 5, cacheWrite: 5, reasoning: 2, reported: 4, models: 2, last: '2026-10-03' },
  );
  const b = groups.find(group => group.provider === 'b');
  assert.equal(b?.reasoningReported, undefined, 'a provider whose models never declared coverage stays unknown');
  assert.deepEqual(b?.models.map(row => row.series.model), ['m3']);
});

test('the recent view keeps the trailing days and ranks the models that fill them', () => {
  const recent = deriveRecent(multiSnapshot(), ALL, 'tokens', { days: 2 });
  assert.deepEqual(recent.days, ['2026-10-02', '2026-10-03']);
  assert.equal(recent.totals.tokens, 460, 'the day the window drops no longer counts');
  assert.equal(recent.totals.activeDays, 2);
  assert.deepEqual(recent.models.map(model => model.series.model), ['m3', 'm2', 'm1'], 'heaviest model of the window first');
  assert.deepEqual(recent.models[2]?.values, [0, 10], 'the shape is aligned with the trailing days');
  assert.deepEqual(recent.dayList[1]?.contributors.map(item => item.model), ['m3', 'm1'], 'heaviest contributor first');
  assert.deepEqual(recent.dayList[0]?.contributors.map(item => item.model), ['m2']);
  assert.equal(recent.others, undefined);
});

test('the recent view caps the rail, folds the tail into others and honours the query', () => {
  const capped = deriveRecent(multiSnapshot(), ALL, 'tokens', { days: 3, models: 1 });
  assert.deepEqual(capped.models.map(model => model.series.model), ['m3']);
  assert.deepEqual(capped.others, { models: 2, tokens: 160, requests: 4 });
  const filtered = deriveRecent(multiSnapshot(), 'a', 'tokens', { days: 3 });
  assert.deepEqual(filtered.models.map(model => model.series.model), ['m1', 'm2']);
  assert.equal(filtered.totals.tokens, 160);
  assert.equal(filtered.totals.requests, 4);
});

test('the recent view folds its days into months for the rail sparkline', () => {
  const recent = deriveRecent(multiSnapshot(), ALL, 'tokens', { days: 3 });
  assert.deepEqual(recent.monthKeys, ['2026-10']);
  assert.deepEqual(recent.models.map(model => model.months), [[400], [110], [50]], 'one bucket per month, heaviest model first');
  const requests = deriveRecent(multiSnapshot(), ALL, 'requests', { days: 3 });
  assert.deepEqual(requests.models.map(model => model.months), [[4], [3], [1]], 'the sparkline follows the metric');
});

test('the recent view follows the selected metric', () => {
  const requests = deriveRecent(multiSnapshot(), ALL, 'requests', { days: 2 });
  assert.deepEqual(requests.models.map(model => model.series.model), ['m3', 'm1', 'm2'], 'ties fall back to the model name');
  assert.deepEqual(requests.models[0]?.values, [0, 4]);
  assert.equal(requests.totals.requests, 6);
  assert.equal(requests.totals.tokens, 460, 'the token totals never change with the metric');
});

test('the hub loads once, keeps the previous window while refreshing and reports failures', async () => {
  const calls: { rangeDays: number; force: boolean }[] = [];
  let fail = false;
  const hub = createUsageHub({
    zone: 'UTC',
    read: async (query) => {
      calls.push({ rangeDays: query.rangeDays, force: query.force === true });
      return fail ? undefined : snapshot();
    },
  });
  const states: UsageState[] = [];
  hub.subscribe(() => states.push(hub.getSnapshot()));

  hub.load();
  hub.load();
  await settle();
  assert.equal(calls.length, 1, 'a second call while one is in flight is ignored');
  assert.equal(hub.getSnapshot().status, 'ready');
  assert.equal(hub.getSnapshot().snapshot?.allTime.tokens, 999);
  assert.equal(hub.getSnapshot().refreshing, false);

  hub.setMetric('requests');
  await settle();
  assert.equal(calls.length, 1, 'changing the metric never re-reads the Host');
  assert.equal(hub.getSnapshot().metric, 'requests');

  hub.setRange(90);
  await settle();
  assert.deepEqual(calls[1], { rangeDays: 90, force: false });
  assert.equal(hub.getSnapshot().rangeDays, 90);

  hub.setQuery('m1');
  assert.equal(hub.getSnapshot().query, 'm1');
  hub.setQuery('m1');
  hub.setQuery('');
  assert.equal(hub.getSnapshot().query, '', 'the filter clears without touching the Host');
  assert.equal(calls.length, 2, 'filtering never re-reads the Host');

  fail = true;
  hub.load(true);
  await settle();
  assert.deepEqual(calls[2], { rangeDays: 90, force: true });
  assert.equal(hub.getSnapshot().status, 'failed');
  assert.ok(hub.getSnapshot().error);
  assert.equal(hub.getSnapshot().snapshot?.allTime.tokens, 999, 'the last good window stays visible');
  assert.ok(states.length > 0);
  hub.dispose();
});

test('a rejected read fails the window instead of leaving it loading', async () => {
  const hub = createUsageHub({ zone: 'UTC', read: async () => { throw new Error('host down'); } });
  hub.load();
  await settle();
  assert.equal(hub.getSnapshot().status, 'failed');
  assert.equal(hub.getSnapshot().snapshot, undefined);
  hub.dispose();
});

test('disposing the hub stops publishing and aborts the request in flight', async () => {
  let aborted = false;
  const hub = createUsageHub({
    zone: 'UTC',
    read: async (_query, signal) => {
      await new Promise<void>(resolve => signal.addEventListener('abort', () => { aborted = true; resolve(); }));
      return snapshot();
    },
  });
  let updates = 0;
  hub.subscribe(() => { updates++; });
  hub.load();
  const seen = updates;
  hub.dispose();
  await settle();
  assert.equal(aborted, true);
  assert.equal(updates, seen, 'nothing is published after disposal');
  assert.equal(hub.getSnapshot().status, 'loading');
});

test('catalog labels survive derivation while filtering keeps stable IDs', () => {
  const data = snapshot();
  data.series[0]!.name = 'Official Model One';
  const view = deriveUsage(data, 'Official', 'tokens');
  assert.equal(view.rows[0]?.series.name, 'Official Model One');
  assert.equal(view.rows[0]?.series.model, 'm1', 'the logged id still identifies the series');
  const recent = deriveRecent(data, 'Official', 'tokens');
  assert.equal(recent.dayList[0]?.contributors[0]?.name, 'Official Model One');
  assert.equal(recent.models[0]?.series.name, 'Official Model One');
});

test('effort distribution preserves unknown coverage and honours the query', () => {
  const data = snapshot();
  data.seriesTotals[0]!.reasoningEfforts = [{ effort: 'high', requests: 1 }, { effort: 'off', requests: 1 }];
  data.seriesTotals[1]!.reasoningEfforts = [{ effort: 'high', requests: 1 }];
  const all = summarizeEffort(deriveUsage(data, ALL, 'tokens').rows);
  assert.deepEqual(all, { entries: [{ effort: 'off', requests: 1 }, { effort: 'high', requests: 2 }], reported: 3, unknown: 1, total: 4 });
  const filtered = summarizeEffort(deriveUsage(data, 'a', 'requests').rows);
  assert.equal(filtered.reported, 2);
  assert.equal(filtered.unknown, 1);
  assert.equal(filtered.total, 3);
  assert.equal(summarizeEffort(deriveUsage(snapshot(), ALL, 'tokens').rows).reported, 0, 'old hosts never become off or zero');
});

test('the dashboard always opens the twelve-month window', async () => {
  let requested = 0;
  const hub = createUsageHub({ zone: 'UTC', read: async query => { requested = query.rangeDays; return snapshot(); } });
  hub.load();
  await settle();
  assert.equal(requested, 365);
  hub.dispose();
});

function settle(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

