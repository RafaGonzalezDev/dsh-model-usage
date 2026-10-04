import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUCKET_MS, bucketOf, emptyTotals, foldSession, mergeInto, seriesId, splitSeriesId, totalTokens,
  type BucketTotals, type UsageEventLike,
} from '../packages/plugin/src/fold.ts';

const TIME = Date.UTC(2026, 9, 4, 14, 24, 11);

const DEFAULT_USAGE = { inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheReadTokens: 40, reasoningTokens: 5 };

function assistant(overrides: {
  time?: number; provider?: string; model?: string; usage?: Record<string, unknown> | null;
} = {}): UsageEventLike {
  const source: Record<string, unknown> = { kind: 'model', provider: overrides.provider ?? 'chatgpt-plan' };
  source['model'] = overrides.model ?? 'gpt-6.1-sol';
  const usage = overrides.usage === undefined ? DEFAULT_USAGE : overrides.usage;
  return {
    type: 'assistant/message',
    time: overrides.time ?? TIME,
    data: {
      message: { role: 'assistant', source },
      ...(usage === null ? {} : { usage }),
    },
  };
}

test('an assistant step folds into one bucket and one series', () => {
  const contribution = foldSession([assistant()]);
  assert.equal(contribution.unusable, 0);
  const series = contribution.buckets.get(bucketOf(TIME));
  assert.ok(series);
  const totals = series.get(seriesId('chatgpt-plan', 'gpt-6.1-sol'));
  assert.deepEqual(totals, { input: 100, output: 20, cacheRead: 40, reasoning: 5, reasoningReported: 1, requests: 1 });
  assert.equal(totalTokens(totals!), 120, 'cache reads and reasoning stay out of the total');
});

test('buckets are 15 minutes wide and reject the events of other buckets', () => {
  assert.equal(BUCKET_MS, 900_000);
  const contribution = foldSession([assistant({ time: TIME }), assistant({ time: TIME + BUCKET_MS })]);
  assert.deepEqual([...contribution.buckets.keys()].sort((a, b) => a - b), [bucketOf(TIME), bucketOf(TIME) + 1]);
  assert.equal(contribution.buckets.get(bucketOf(TIME))!.get(seriesId('chatgpt-plan', 'gpt-6.1-sol'))!.requests, 1);
});

test('a step without usage still counts as a request with zero tokens', () => {
  const contribution = foldSession([assistant({ usage: null })]);
  const totals = contribution.buckets.get(bucketOf(TIME))!.get(seriesId('chatgpt-plan', 'gpt-6.1-sol'))!;
  assert.deepEqual(totals, { input: 0, output: 0, cacheRead: 0, reasoning: 0, requests: 1 });
});

test('a model step without a model name is unusable, not silently attributed', () => {
  const event = assistant();
  const data = event.data as { message: { source: Record<string, unknown> } };
  delete data.message.source['model'];
  const contribution = foldSession([event]);
  assert.equal(contribution.unusable, 1);
  assert.equal(contribution.buckets.size, 0);
});

test('a missing provider falls back to unknown instead of losing the tokens', () => {
  const event = assistant();
  const data = event.data as { message: { source: Record<string, unknown> } };
  delete data.message.source['provider'];
  const contribution = foldSession([event]);
  assert.ok(contribution.buckets.get(bucketOf(TIME))!.has(seriesId('unknown', 'gpt-6.1-sol')));
});

test('compaction summaries count with their own provider and model', () => {
  const contribution = foldSession([{
    type: 'compaction/summary',
    time: TIME,
    data: { provider: 'chatgpt-plan', model: 'gpt-6-astra', usage: { inputTokens: 47_322, outputTokens: 4_136, totalTokens: 51_458, cacheReadTokens: 0, reasoningTokens: 0 } },
  }]);
  const totals = contribution.buckets.get(bucketOf(TIME))!.get(seriesId('chatgpt-plan', 'gpt-6-astra'))!;
  assert.deepEqual(totals, { input: 47_322, output: 4_136, cacheRead: 0, reasoning: 0, reasoningReported: 1, requests: 1 });
});

test('attempts, requests and unrelated events never count', () => {
  const contribution = foldSession([
    { type: 'assistant/attempt', time: TIME, data: { turn: 2, step: 22, stream: { kind: 'open' } } },
    { type: 'session/title-llm-request', time: TIME, data: { route: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' } } },
    { type: 'step/end', time: TIME, data: { turn: 1, step: 1 } },
  ]);
  assert.equal(contribution.buckets.size, 0);
  assert.equal(contribution.unusable, 0, 'ignored events are not failures');
});

test('malformed counters are floored to zero rather than poisoning the totals', () => {
  const contribution = foldSession([assistant({ usage: { inputTokens: -5, outputTokens: Number.NaN, cacheReadTokens: 'x', reasoningTokens: 2.7 } })]);
  const totals = contribution.buckets.get(bucketOf(TIME))!.get(seriesId('chatgpt-plan', 'gpt-6.1-sol'))!;
  assert.deepEqual(totals, { input: 0, output: 0, cacheRead: 0, reasoning: 2, reasoningReported: 1, requests: 1 });
});

test('an event without a usable timestamp is reported, not misdated', () => {
  const event = assistant();
  delete event.time;
  const contribution = foldSession([event]);
  assert.equal(contribution.unusable, 1);
  assert.equal(contribution.buckets.size, 0);
});

test('mergeInto sums the same series and keeps different series apart', () => {
  const target: BucketTotals = new Map();
  const bucket = bucketOf(TIME);
  target.set(bucket, new Map([[seriesId('a', 'm'), { ...emptyTotals(), input: 1, requests: 1 }]]));
  mergeInto(target, new Map([[bucket, new Map([
    [seriesId('a', 'm'), { ...emptyTotals(), input: 2, output: 3, requests: 1 }],
    [seriesId('b', 'n'), { ...emptyTotals(), input: 9, requests: 1 }],
  ])]]));
  const series = target.get(bucket)!;
  assert.deepEqual(series.get(seriesId('a', 'm')), { input: 3, output: 3, cacheRead: 0, reasoning: 0, requests: 2 });
  assert.deepEqual(series.get(seriesId('b', 'n')), { input: 9, output: 0, cacheRead: 0, reasoning: 0, requests: 1 });
});

test('reasoning availability distinguishes absent, invalid and explicitly zero usage', () => {
  for (const value of [undefined, null, '0', -1, NaN, Infinity, -Infinity, 0, 2.7]) {
    const contribution = foldSession([assistant({ usage: { reasoningTokens: value } })]);
    const totals = contribution.buckets.get(bucketOf(TIME))!.get(seriesId('chatgpt-plan', 'gpt-6.1-sol'))!;
    assert.equal(totals.reasoningReported, value === 0 || value === 2.7 ? 1 : undefined);
    assert.equal(totals.requests, 1);
  }
});

test('partial reasoning coverage survives bucket merging without inventing reports', () => {
  const target: BucketTotals = new Map();
  for (const usage of [{}, { reasoningTokens: 0 }, { reasoningTokens: 7 }, {}]) {
    mergeInto(target, foldSession([assistant({ usage })]).buckets);
  }
  const totals = target.get(bucketOf(TIME))!.get(seriesId('chatgpt-plan', 'gpt-6.1-sol'))!;
  assert.deepEqual(totals, { input: 0, output: 0, cacheRead: 0, reasoning: 7, reasoningReported: 2, requests: 4 });
});

test('effort follows only matching logged headers and resets rather than inferring defaults', () => {
  const header = (reasoningEffort?: unknown): UsageEventLike => ({ type: 'request/header', data: { header: { config: { provider: 'chatgpt-plan', model: 'gpt-6.1-sol', reasoningEffort } } } });
  const events = [assistant(), header('high'), assistant(), assistant({ model: 'other' }),
    { type: 'compaction/summary', time: TIME, data: { provider: 'chatgpt-plan', model: 'gpt-6.1-sol' } },
    assistant({ usage: null }), header(), assistant(), header('off'), assistant(), header(42), assistant(),
    header('max'), { type: 'request/header', data: {} }, assistant()];
  const source = foldSession(events).buckets;
  const value = source.get(bucketOf(TIME))!.get(seriesId('chatgpt-plan', 'gpt-6.1-sol'))!;
  assert.equal(value.requests, 8);
  assert.deepEqual(value.reasoningEfforts, [{ effort: 'high', requests: 2 }, { effort: 'off', requests: 1 }]);
  const merged: BucketTotals = new Map();
  mergeInto(merged, source);
  mergeInto(merged, source);
  assert.deepEqual(merged.get(bucketOf(TIME))!.get(seriesId('chatgpt-plan', 'gpt-6.1-sol'))!.reasoningEfforts,
    [{ effort: 'high', requests: 4 }, { effort: 'off', requests: 2 }]);
  assert.equal(value.reasoningEfforts![0]!.requests, 2, 'merging must not mutate cached inputs');
});

test('forked headers remain local to each fold and a resumed header replaces inherited effort', () => {
  const header = (reasoningEffort?: string): UsageEventLike => ({ type: 'request/header', data: { header: { config: { provider: 'chatgpt-plan', model: 'gpt-6.1-sol', reasoningEffort } } } });
  const inherited = [header('high'), assistant()];
  const parent = foldSession([...inherited, assistant()]);
  const child = foldSession([...inherited, { type: 'session/end-seed', data: { inherited: true } }, header('low'), assistant(), header(), assistant()]);
  const total = (fold: ReturnType<typeof foldSession>) => fold.buckets.get(bucketOf(TIME))!.get(seriesId('chatgpt-plan', 'gpt-6.1-sol'))!;
  assert.deepEqual(total(parent).reasoningEfforts, [{ effort: 'high', requests: 2 }]);
  assert.deepEqual(total(child).reasoningEfforts, [{ effort: 'high', requests: 1 }, { effort: 'low', requests: 1 }]);
  assert.equal(total(child).requests, 3);
  assert.equal(total(foldSession([assistant()])).reasoningEfforts, undefined, 'no state leaks between sessions');
});

test('series ids survive provider and model names that contain separators', () => {
  const id = seriesId('openrouter', 'anthropic/claude');
  assert.deepEqual(splitSeriesId(id), { provider: 'openrouter', model: 'anthropic/claude' });
  assert.deepEqual(splitSeriesId('bare-model'), { provider: 'unknown', model: 'bare-model' });
});
