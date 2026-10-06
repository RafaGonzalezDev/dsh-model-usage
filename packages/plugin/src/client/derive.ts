/** Derivation shared by the dashboard parts: filtering, per-day series, rows, groups and levels. */
import { quartiles } from '../calendar.ts';
import type { UsageSeries, UsageSnapshot } from '../contracts.ts';

export type UsageMetric = 'tokens' | 'requests';

/** One breakdown row: the window totals of a single (provider, model) pair. */
export interface UsageRow {
  index: number;
  series: UsageSeries;
  tokens: number;
  requests: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Both cache halves as the table presents them; the split stays available in the row. */
  cache: number;
  reasoning: number;
  /** Requests with an explicit finite reasoning count in the durable log. */
  reasoningReported?: number;
  reasoningEfforts?: { effort: string; requests: number }[];
  /** Last day of the window this pair reported activity. */
  lastDay: string | undefined;
}

export interface UsageView {
  rows: UsageRow[];
  /** Day keys of the window, ascending. */
  days: string[];
  /** Selected metric per day, filtered. */
  dayValues: number[];
  dayTokens: number[];
  dayRequests: number[];
  /** Intensity cut-offs over the active days, or undefined when the window is idle. */
  cuts: readonly [number, number, number] | undefined;
  totals: {
    tokens: number;
    requests: number;
    activeDays: number;
    peak: { day: string; value: number } | undefined;
    models: number;
    providers: number;
  };
}

/** A query matches the display name, the logged model id and the provider alike. */
export function matchesQuery(series: UsageSeries, needle: string): boolean {
  return `${series.name ?? ''} ${series.model} ${series.provider}`.toLocaleLowerCase().includes(needle);
}

/** Every series the query keeps, as indices into `snapshot.series`; an empty query keeps them all. */
export function keptSeries(snapshot: UsageSnapshot, query: string): Set<number> {
  const needle = query.trim().toLocaleLowerCase();
  const kept = new Set<number>();
  snapshot.series.forEach((series, index) => {
    if (needle === '' || matchesQuery(series, needle)) kept.add(index);
  });
  return kept;
}

/** Apply the query and the selected metric to one snapshot. */
export function deriveUsage(snapshot: UsageSnapshot, query: string, metric: UsageMetric): UsageView {
  const kept = keptSeries(snapshot, query);

  const dayTokens = new Array<number>(snapshot.days.length).fill(0);
  const dayRequests = new Array<number>(snapshot.days.length).fill(0);
  const lastDay = new Map<number, string>();
  for (const cell of snapshot.cells) {
    if (!kept.has(cell.series)) continue;
    dayTokens[cell.day] = (dayTokens[cell.day] ?? 0) + cell.tokens;
    dayRequests[cell.day] = (dayRequests[cell.day] ?? 0) + cell.requests;
    // Cells arrive in ascending day order, so the last write is the most recent day.
    lastDay.set(cell.series, snapshot.days[cell.day] ?? '');
  }

  const rows: UsageRow[] = [];
  for (const totals of snapshot.seriesTotals) {
    if (!kept.has(totals.series)) continue;
    const series = snapshot.series[totals.series];
    if (series === undefined) continue;
    rows.push({
      index: totals.series,
      series,
      // An older Host sends no total; the four disjoint components are then summed here.
      tokens: totals.tokens ?? totals.input + totals.output + totals.cacheRead + (totals.cacheWrite ?? 0),
      requests: totals.requests,
      input: totals.input,
      output: totals.output,
      cacheRead: totals.cacheRead,
      cacheWrite: totals.cacheWrite ?? 0,
      cache: totals.cacheRead + (totals.cacheWrite ?? 0),
      reasoning: totals.reasoning,
      ...(totals.reasoningReported === undefined ? {} : { reasoningReported: totals.reasoningReported }),
      ...(totals.reasoningEfforts === undefined ? {} : { reasoningEfforts: totals.reasoningEfforts }),
      lastDay: lastDay.get(totals.series),
    });
  }
  const valueOf = (row: UsageRow): number => (metric === 'tokens' ? row.tokens : row.requests);
  rows.sort((a, b) => valueOf(b) - valueOf(a) || a.series.model.localeCompare(b.series.model));

  const dayValues = metric === 'tokens' ? dayTokens : dayRequests;
  let peakIndex = -1;
  for (let day = 0; day < dayValues.length; day++) {
    if (peakIndex < 0 || (dayValues[day] ?? 0) > (dayValues[peakIndex] ?? 0)) peakIndex = day;
  }
  const peakValue = peakIndex < 0 ? 0 : dayValues[peakIndex] ?? 0;

  return {
    rows,
    days: snapshot.days,
    dayValues,
    dayTokens,
    dayRequests,
    cuts: quartiles(dayValues),
    totals: {
      tokens: dayTokens.reduce((sum, value) => sum + value, 0),
      requests: dayRequests.reduce((sum, value) => sum + value, 0),
      activeDays: dayValues.filter(value => value > 0).length,
      peak: peakValue > 0 ? { day: snapshot.days[peakIndex] ?? '', value: peakValue } : undefined,
      models: new Set(rows.map(row => row.series.model)).size,
      providers: new Set(rows.map(row => row.series.provider)).size,
    },
  };
}

/** One provider and the models it served inside the window. */
export interface ProviderGroup {
  provider: string;
  tokens: number;
  requests: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Both cache halves as the table presents them. */
  cache: number;
  reasoning: number;
  /** Sum of the reported counts, or undefined when no model of the group declared one. */
  reasoningReported: number | undefined;
  lastDay: string | undefined;
  models: UsageRow[];
}

/** Fold the breakdown rows into provider groups, heaviest group first. */
export function groupByProvider(rows: UsageRow[], metric: UsageMetric = 'tokens'): ProviderGroup[] {
  const groups = new Map<string, ProviderGroup>();
  for (const row of rows) {
    let group = groups.get(row.series.provider);
    if (group === undefined) {
      group = {
        provider: row.series.provider,
        tokens: 0,
        requests: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cache: 0,
        reasoning: 0,
        reasoningReported: undefined,
        lastDay: undefined,
        models: [],
      };
      groups.set(row.series.provider, group);
    }
    group.tokens += row.tokens;
    group.requests += row.requests;
    group.input += row.input;
    group.output += row.output;
    group.cacheRead += row.cacheRead;
    group.cacheWrite += row.cacheWrite;
    group.cache += row.cache;
    group.reasoning += row.reasoning;
    if (row.reasoningReported !== undefined) group.reasoningReported = (group.reasoningReported ?? 0) + row.reasoningReported;
    if (row.lastDay !== undefined && (group.lastDay === undefined || row.lastDay > group.lastDay)) group.lastDay = row.lastDay;
    group.models.push(row);
  }
  const valueOf = (group: ProviderGroup): number => (metric === 'tokens' ? group.tokens : group.requests);
  return [...groups.values()].sort((a, b) => valueOf(b) - valueOf(a) || a.provider.localeCompare(b.provider));
}

/** One model that contributed on a single recent day. */
export interface RecentContributor {
  model: string;
  name?: string;
  provider: string;
  tokens: number;
  requests: number;
}

/** One day of the recent window, with the heaviest models of that day. */
export interface RecentDay {
  day: string;
  tokens: number;
  requests: number;
  /** Selected metric of the day. */
  value: number;
  contributors: RecentContributor[];
}

/** One model of the recent window and its daily shape. */
export interface RecentModel {
  index: number;
  series: UsageSeries;
  tokens: number;
  requests: number;
  /** Selected metric per day, index-aligned with `days`. */
  values: number[];
  /** Selected metric per month, index-aligned with `monthKeys`; the rail sparkline reads this. */
  months: number[];
}

export interface RecentView {
  days: string[];
  /** Ascending `YYYY-MM` keys covered by `days`. */
  monthKeys: string[];
  dayList: RecentDay[];
  /** Heaviest models of the window, already capped. */
  models: RecentModel[];
  totals: { tokens: number; requests: number; activeDays: number };
  cuts: readonly [number, number, number] | undefined;
  /** Everything the cap left out, or undefined when every model is listed. */
  others: { models: number; tokens: number; requests: number } | undefined;
}

export interface RecentOptions {
  /** Trailing days to keep; defaults to 365. */
  days?: number;
  /** Models the rail lists before folding the rest into `others`; defaults to 6. */
  models?: number;
}

/** The trailing slice of the window: a compact calendar plus the models that fill it. */
export function deriveRecent(
  snapshot: UsageSnapshot,
  query: string,
  metric: UsageMetric,
  options: RecentOptions = {},
): RecentView {
  const span = Math.max(1, options.days ?? 365);
  const cap = Math.max(1, options.models ?? 6);
  const kept = keptSeries(snapshot, query);
  const start = Math.max(0, snapshot.days.length - span);
  const days = snapshot.days.slice(start);
  const monthIndex = new Map<string, number>();
  const monthKeys: string[] = [];
  for (const day of days) {
    const key = day.slice(0, 7);
    if (monthIndex.has(key)) continue;
    monthIndex.set(key, monthKeys.length);
    monthKeys.push(key);
  }

  const dayTokens = new Array<number>(days.length).fill(0);
  const dayRequests = new Array<number>(days.length).fill(0);
  const contributors: { series: number; tokens: number; requests: number }[][] = days.map(() => []);
  const perSeries = new Map<number, { tokens: number; requests: number; values: number[] }>();

  for (const cell of snapshot.cells) {
    if (!kept.has(cell.series)) continue;
    const day = cell.day - start;
    if (day < 0 || day >= days.length) continue;
    dayTokens[day] = (dayTokens[day] ?? 0) + cell.tokens;
    dayRequests[day] = (dayRequests[day] ?? 0) + cell.requests;
    (contributors[day] ??= []).push({ series: cell.series, tokens: cell.tokens, requests: cell.requests });
    let totals = perSeries.get(cell.series);
    if (totals === undefined) {
      totals = { tokens: 0, requests: 0, values: new Array<number>(days.length).fill(0) };
      perSeries.set(cell.series, totals);
    }
    totals.tokens += cell.tokens;
    totals.requests += cell.requests;
    totals.values[day] = (totals.values[day] ?? 0) + (metric === 'tokens' ? cell.tokens : cell.requests);
  }

  const dayValues = metric === 'tokens' ? dayTokens : dayRequests;
  const dayList: RecentDay[] = days.map((day, index) => ({
    day,
    tokens: dayTokens[index] ?? 0,
    requests: dayRequests[index] ?? 0,
    value: dayValues[index] ?? 0,
    contributors: [...(contributors[index] ?? [])]
      .sort((a, b) => (metric === 'tokens' ? b.tokens - a.tokens : b.requests - a.requests))
      .slice(0, 3)
      .flatMap(item => {
        const series = snapshot.series[item.series];
        if (series === undefined) return [];
        return [{ model: series.model, ...(series.name ? { name: series.name } : {}), provider: series.provider, tokens: item.tokens, requests: item.requests }];
      }),
  }));

  const ranked: RecentModel[] = [...perSeries.entries()].flatMap(([index, totals]) => {
    const series = snapshot.series[index];
    if (series === undefined) return [];
    const months = new Array<number>(monthKeys.length).fill(0);
    totals.values.forEach((value, day) => {
      const at = monthIndex.get((days[day] ?? '').slice(0, 7));
      if (at !== undefined) months[at] = (months[at] ?? 0) + value;
    });
    return [{ index, series, tokens: totals.tokens, requests: totals.requests, values: totals.values, months }];
  });
  const valueOf = (model: RecentModel): number => (metric === 'tokens' ? model.tokens : model.requests);
  ranked.sort((a, b) => valueOf(b) - valueOf(a) || a.series.model.localeCompare(b.series.model));

  const models = ranked.slice(0, cap);
  const dropped = ranked.slice(cap);
  const others = dropped.length === 0 ? undefined : {
    models: dropped.length,
    tokens: dropped.reduce((sum, model) => sum + model.tokens, 0),
    requests: dropped.reduce((sum, model) => sum + model.requests, 0),
  };

  return {
    days,
    monthKeys,
    dayList,
    models,
    totals: {
      tokens: dayTokens.reduce((sum, value) => sum + value, 0),
      requests: dayRequests.reduce((sum, value) => sum + value, 0),
      activeDays: dayValues.filter(value => value > 0).length,
    },
    cuts: quartiles(dayValues),
    others,
  };
}
