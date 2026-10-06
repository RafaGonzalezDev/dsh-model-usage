/** Public, token-free Host/Client contracts for the global model-usage dashboard. */

/** Window lengths the dashboard offers, in days, ending today in the answering zone. */
export type UsageRangeDays = 30 | 90 | 180 | 365;

/** Every window the Client may request, in the order the panel presents them. */
export const USAGE_RANGE_DAYS: readonly UsageRangeDays[] = [30, 90, 180, 365];

/** Default window: the full heatmap year. */
export const DEFAULT_USAGE_RANGE_DAYS: UsageRangeDays = 365;

/** One dashboard request. */
export interface UsageQuery {
  rangeDays: UsageRangeDays;
  /** IANA zone the Client renders days in; the Host falls back to its own zone. */
  zone?: string;
  /** Ignore the per-session signature cache and inspect every session again. */
  force?: boolean;
}

/** One (provider, model) pair the corpus reported activity for. */
export interface UsageSeries {
  /** Stable identity of the pair. */
  id: string;
  provider: string;
  model: string;
  /** Current DSH catalog name for this exact provider/model; fall back to model when absent. */
  name?: string;
}

/** One day × series cell with activity; idle cells never travel. */
export interface UsageCell {
  /** Index into `days`. */
  day: number;
  /** Index into `series`. */
  series: number;
  /** Provider total: uncached input plus output plus cache reads and cache writes. */
  tokens: number;
  /** Assistant steps plus compaction summaries that reported this pair. */
  requests: number;
}

/** One series' totals inside the window; the breakdown table reads these. */
export interface UsageSeriesTotals {
  /** Index into `series`. */
  series: number;
  /** Provider total for this series; an older Host omits it and the Client recomputes it. */
  tokens?: number;
  /** Uncached prompt tokens; cache reads and writes are reported apart and never folded in. */
  input: number;
  output: number;
  /** Prompt tokens served from the provider cache. */
  cacheRead: number;
  /** Prompt tokens written to the provider cache; omitted by an older Host. */
  cacheWrite?: number;
  /** Subset of `output`; never added to the total on its own. */
  reasoning: number;
  /** Requests with finite non-negative reasoningTokens in normalized logs, including zero.
   * Omitted means no reported requests (or an older Host); not proof of original API exposure. */
  reasoningReported?: number;
  /** Logged request/header efforts for matching assistant requests, not token counts.
   * Missing requests (including compactions) have unknown effort, never an inferred default. */
  reasoningEfforts?: { effort: string; requests: number }[];
  requests: number;
}

/** Everything the dashboard needs for one request; every other figure is derived in the Client. */
export interface UsageSnapshot {
  /** Host clock when the aggregate was produced. */
  generatedAt: number;
  /** Zone the day keys belong to. */
  zone: string;
  /** True when the requested zone was refused and the Host zone answered instead. */
  zoneFallback: boolean;
  /** First day of the window, inclusive, as `YYYY-MM-DD` in `zone`. */
  from: string;
  /** Last day of the window, inclusive. */
  to: string;
  /** Ascending day keys covering `from`..`to`. */
  days: string[];
  /** Pairs with activity inside the window, heaviest first. */
  series: UsageSeries[];
  /** Non-zero cells of the window. */
  cells: UsageCell[];
  /** Window totals per series, index-aligned with `series`. */
  seriesTotals: UsageSeriesTotals[];
  /** Whole-corpus totals, independent of the window. */
  allTime: { tokens: number; requests: number };
  /** Corpus coverage of the scan that produced this snapshot. */
  scanned: { sessions: number; live: number; skipped: number };
}
