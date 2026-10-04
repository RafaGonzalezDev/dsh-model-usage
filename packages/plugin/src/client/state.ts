/** The dashboard's client-side store: one observable state, one loader, no transport in components. */
import { DEFAULT_USAGE_RANGE_DAYS, type UsageQuery, type UsageRangeDays, type UsageSnapshot } from '../contracts.ts';
import { copy } from './copy.ts';
import type { UsageMetric } from './derive.ts';

export interface UsageState {
  status: 'idle' | 'loading' | 'ready' | 'failed';
  /** A request is in flight; the previous snapshot stays visible while it runs. */
  refreshing: boolean;
  snapshot: UsageSnapshot | undefined;
  error: string | undefined;
  rangeDays: UsageRangeDays;
  metric: UsageMetric;
  /** Live text filter over model, display name and provider; empty keeps everything. */
  query: string;
}

export interface UsageHub {
  getSnapshot(): UsageState;
  subscribe(listener: () => void): () => void;
  /** Fetch the window; the first call wins while another is in flight. */
  load(force?: boolean): void;
  setRange(rangeDays: UsageRangeDays): void;
  setMetric(metric: UsageMetric): void;
  setQuery(query: string): void;
  dispose(): void;
}

export interface UsageHubOptions {
  read(query: UsageQuery, signal: AbortSignal): Promise<UsageSnapshot | undefined>;
  /** The browser zone the days are rendered in. */
  zone: string;
}

export function createUsageHub(options: UsageHubOptions): UsageHub {
  let state: UsageState = {
    status: 'idle',
    refreshing: false,
    snapshot: undefined,
    error: undefined,
    rangeDays: DEFAULT_USAGE_RANGE_DAYS,
    metric: 'tokens',
    query: '',
  };
  const listeners = new Set<() => void>();
  let inFlight: AbortController | undefined;
  let disposed = false;

  const publish = (next: Partial<UsageState>): void => {
    if (disposed) return;
    state = { ...state, ...next };
    for (const listener of [...listeners]) listener();
  };

  const load = (force = false): void => {
    if (disposed || inFlight !== undefined) return;
    const controller = new AbortController();
    inFlight = controller;
    publish({ refreshing: true, status: state.snapshot === undefined ? 'loading' : state.status, error: undefined });
    const query: UsageQuery = { rangeDays: state.rangeDays, zone: options.zone, ...(force ? { force: true } : {}) };
    void options.read(query, controller.signal).then(
      snapshot => {
        if (controller.signal.aborted) return;
        publish(snapshot === undefined
          ? { status: 'failed', refreshing: false, error: copy.failed }
          : { status: 'ready', refreshing: false, snapshot, error: undefined });
      },
      () => { if (!controller.signal.aborted) publish({ status: 'failed', refreshing: false, error: copy.failed }); },
    ).finally(() => { if (inFlight === controller) inFlight = undefined; });
  };

  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    load,
    setRange: (rangeDays: UsageRangeDays) => {
      if (rangeDays === state.rangeDays) return;
      publish({ rangeDays });
      load();
    },
    setMetric: (metric: UsageMetric) => { if (metric !== state.metric) publish({ metric }); },
    setQuery: (query: string) => { if (query !== state.query) publish({ query }); },
    dispose: () => {
      disposed = true;
      inFlight?.abort();
      inFlight = undefined;
      listeners.clear();
    },
  };
}

/** The zone the browser renders days in, or an empty string when it cannot be read. */
export function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
}
