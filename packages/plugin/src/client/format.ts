/** Presentation-only formatting; no figure is ever rounded before it is summed. */

const dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
const clockFormatter = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' });

/** Compact token figure: `987`, `12.34K`, `448.60M`, `1.20B`. */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value < 1_000) return String(Math.round(value));
  if (value < 1_000_000) return `${(value / 1_000).toFixed(2)}K`;
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  return `${(value / 1_000_000_000).toFixed(2)}B`;
}

/** Exact count with English grouping. */
export function formatCount(value: number): string {
  return Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : '0';
}

/** `2026-05-04` as `May 4, 2026`; the key is already a civil date, so it is read as UTC. */
export function formatDay(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  if (!year || !month || !day) return key;
  return dayFormatter.format(new Date(Date.UTC(year, month - 1, day)));
}

/** `2026-05-04` as `May 4`; the year is dropped for the dense heatmap tooltip. */
export function formatDayShort(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  if (!year || !month || !day) return key;
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** Host clock time of one epoch instant. */
export function formatClock(instant: number): string {
  return clockFormatter.format(new Date(instant));
}

/** Share of a whole as a one-decimal percentage. */
export function formatShare(part: number, whole: number): string {
  if (whole <= 0) return '0%';
  return `${((part / whole) * 100).toFixed(1)}%`;
}
