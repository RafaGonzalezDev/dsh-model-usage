import assert from 'node:assert/strict';
import test from 'node:test';
import { dayKey, dayKeysFor, hostZone, levelOf, quartiles, weekdayIndex } from '../packages/plugin/src/calendar.ts';

const NOW = Date.UTC(2026, 9, 4, 14, 24, 11); // 2026-10-04T16:24 in Europe/Madrid

test('a day key is the civil day of the zone, not of the host clock', () => {
  assert.equal(dayKey(NOW, 'Europe/Madrid'), '2026-10-04');
  assert.equal(dayKey(NOW, 'UTC'), '2026-10-04');
});

test('zones with 45-minute offsets land on the day their own clock shows', () => {
  const late = Date.UTC(2026, 9, 4, 18, 20, 0); // 2026-10-05T00:05 in Asia/Kathmandu
  assert.equal(dayKey(late, 'Asia/Kathmandu'), '2026-10-05');
  assert.equal(dayKey(late, 'UTC'), '2026-10-04');
});

test('a 23-hour day keeps its own key and its neighbours are contiguous', () => {
  // Europe/Madrid springs forward on 2026-03-29.
  assert.equal(dayKey(Date.UTC(2026, 2, 28, 23, 30, 0), 'Europe/Madrid'), '2026-03-29');
  assert.equal(dayKey(Date.UTC(2026, 2, 29, 22, 30, 0), 'Europe/Madrid'), '2026-03-30');
});

test('the window ends today and is contiguous across a daylight-saving change', () => {
  assert.deepEqual(dayKeysFor(NOW, 3, 'Europe/Madrid'), ['2026-10-02', '2026-10-03', '2026-10-04']);
  assert.deepEqual(dayKeysFor(Date.UTC(2026, 2, 30, 10, 0, 0), 3, 'Europe/Madrid'), ['2026-03-28', '2026-03-29', '2026-03-30']);
  assert.deepEqual(dayKeysFor(NOW, 1, 'Europe/Madrid'), ['2026-10-04']);
});

test('a full year window is exactly as long as requested', () => {
  const days = dayKeysFor(NOW, 365, 'Europe/Madrid');
  assert.equal(days.length, 365);
  assert.equal(days[0], '2025-10-05');
  assert.equal(days[364], '2026-10-04');
});

test('the weekday grid is Monday-first', () => {
  assert.equal(weekdayIndex('2026-10-04'), 6, 'Sunday is the last row');
  assert.equal(weekdayIndex('2026-10-05'), 0, 'Monday is the first row');
  assert.equal(weekdayIndex('2026-10-10'), 5);
});

test('quartile levels separate the idle days from the active ones', () => {
  const cuts = quartiles([1, 2, 3, 4, 0, 0]);
  assert.deepEqual(cuts, [2, 3, 4]);
  assert.equal(levelOf(0, cuts), 0);
  assert.equal(levelOf(1, cuts), 1);
  assert.equal(levelOf(2, cuts), 2);
  assert.equal(levelOf(3, cuts), 3);
  assert.equal(levelOf(9, cuts), 4);
});

test('a window with a single active day paints it at full intensity', () => {
  const cuts = quartiles([0, 0, 5]);
  assert.deepEqual(cuts, [5, 5, 5]);
  assert.equal(levelOf(5, cuts), 4);
});

test('an entirely idle window has no cut-offs and renders every day empty', () => {
  const cuts = quartiles([0, 0]);
  assert.equal(cuts, undefined);
  assert.equal(levelOf(0, cuts), 0);
  assert.equal(levelOf(3, cuts), 0);
});

test('the host zone is always a usable zone name', () => {
  assert.ok(hostZone().length > 0);
  assert.doesNotThrow(() => dayKey(NOW, hostZone()));
});
