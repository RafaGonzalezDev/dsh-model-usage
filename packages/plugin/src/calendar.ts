/**
 * Zone-correct calendar helpers shared by both halves of the plugin.
 *
 * This module stays free of DSH imports so the Client bundle can reuse the pure parts
 * (weekday placement and quartile levels) without pulling Host-only code into the browser.
 */

/** Sampling step used to enumerate civil days; a local day is never shorter than this. */
const DAY_SCAN_STEP_MS = 6 * 3_600_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
    formatters.set(zone, formatter);
  }
  return formatter;
}

function part(parts: readonly Intl.DateTimeFormatPart[], type: string): string {
  return parts.find(item => item.type === type)?.value ?? '';
}

/** The zone this process renders days in when the caller has no usable one. */
export function hostZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** Civil day of one instant in one zone, as `YYYY-MM-DD`. */
export function dayKey(instant: number, zone: string): string {
  const parts = formatterFor(zone).formatToParts(new Date(instant));
  return `${part(parts, 'year')}-${part(parts, 'month')}-${part(parts, 'day')}`;
}

/** The `rangeDays` civil days ending on the day `now` falls in, ascending. */
export function dayKeysFor(now: number, rangeDays: number, zone: string): string[] {
  const keys: string[] = [];
  // A 25-hour day needs five 6-hour steps to leave; six per day plus slack always terminates.
  const limit = Math.max(1, rangeDays) * 6 + 8;
  let instant = now;
  for (let step = 0; step < limit && keys.length < rangeDays; step++) {
    const key = dayKey(instant, zone);
    if (keys[keys.length - 1] !== key) keys.push(key);
    instant -= DAY_SCAN_STEP_MS;
  }
  return keys.reverse();
}

/** Monday-first weekday index of a civil day key: 0 is Monday, 6 is Sunday. */
export function weekdayIndex(key: string): number {
  const [year, month, day] = key.split('-').map(Number);
  if (!year || !month || !day) return 0;
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

/** Quarter, half and three-quarter cut-offs of the active values, or undefined when all are idle. */
export function quartiles(values: readonly number[]): readonly [number, number, number] | undefined {
  const active = values.filter(value => value > 0).sort((a, b) => a - b);
  if (active.length === 0) return undefined;
  const at = (quantile: number): number => active[Math.min(active.length - 1, Math.floor(quantile * active.length))] ?? 0;
  return [at(0.25), at(0.5), at(0.75)];
}

/** Intensity 0-4 of one value against the cut-offs; an idle value is always 0. */
export function levelOf(value: number, cuts: readonly [number, number, number] | undefined): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || cuts === undefined) return 0;
  if (value >= cuts[2]) return 4;
  if (value >= cuts[1]) return 3;
  if (value >= cuts[0]) return 2;
  return 1;
}
