import type { UsageRow } from './derive.ts';

const ORDER = ['off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/** Effort is a logged configuration, not a measured amount of reasoning. */
export function summarizeEffort(rows: readonly UsageRow[]) {
  const counts = new Map<string, number>();
  let total = 0;
  for (const row of rows) {
    total += row.requests;
    for (const item of row.reasoningEfforts ?? []) counts.set(item.effort, (counts.get(item.effort) ?? 0) + item.requests);
  }
  const entries = [...counts].map(([effort, requests]) => ({ effort, requests })).sort((a, b) => {
    const rank = (value: string) => ORDER.includes(value) ? ORDER.indexOf(value) : ORDER.length;
    return rank(a.effort) - rank(b.effort) || a.effort.localeCompare(b.effort);
  });
  const reported = entries.reduce((sum, item) => sum + item.requests, 0);
  return { entries, reported, total, unknown: Math.max(0, total - reported) };
}
