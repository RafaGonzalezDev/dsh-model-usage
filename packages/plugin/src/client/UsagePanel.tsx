import { useEffect, useMemo } from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import type { HostObservable, InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import { BreakdownTable } from './BreakdownTable.tsx';
import { Overview } from './Overview.tsx';
import { EffortSummary } from './EffortSummary.tsx';
import { copy } from './copy.ts';
import { deriveRecent, deriveUsage, type UsageMetric } from './derive.ts';
import { formatClock, formatDay } from './format.ts';
import type { UsageState } from './state.ts';

export interface UsagePanelInjected {
  hooks: { usage: HostObservable<UsageState> };
  load(force?: boolean): void;
  setMetric(metric: UsageMetric): void;
  setQuery(query: string): void;
  back(): void;
}

type UsagePanelProps = PropsRuntime<'main'> & InjectFace<UsagePanelInjected>;

/** The dashboard: window header, the combined overview and the provider breakdown. */
export function UsagePanel(props: UsagePanelProps) {
  const state = props.useUsage(value => value);
  useEffect(() => { props.load(); }, []);

  const view = useMemo(
    () => (state.snapshot === undefined ? undefined : deriveUsage(state.snapshot, state.query, state.metric)),
    [state.snapshot, state.query, state.metric],
  );
  const recent = useMemo(
    () => (state.snapshot === undefined ? undefined : deriveRecent(state.snapshot, state.query, state.metric)),
    [state.snapshot, state.query, state.metric],
  );

  return <section className="dsh-model-usage-panel" aria-label={copy.title}>
    <div className="dsh-model-usage-content">
      <header className="dsh-model-usage-header">
        <div className="dsh-model-usage-heading">
          <p className="dsh-model-usage-eyebrow">{copy.eyebrow}</p>
          <h1 className="dsh-model-usage-title">{copy.title}</h1>
          <p className="dsh-model-usage-subtitle">{copy.subtitle}</p>
        </div>
        <div className="dsh-model-usage-header-side">
          <div className="dsh-model-usage-header-actions">
            <Button variant="ghost" size="sm" onClick={props.back}>{copy.back}</Button>
            <Button variant="outline" size="sm" disabled={state.refreshing} onClick={() => props.load(true)}>
              {state.refreshing ? copy.refreshing : copy.refresh}
            </Button>
          </div>
        </div>
      </header>

      {state.snapshot === undefined && state.status === 'loading' && <p className="dsh-model-usage-note" role="status">{copy.loading}</p>}
      {state.snapshot === undefined && state.status === 'failed' && <div className="dsh-model-usage-failure" role="alert">
        <p>{state.error ?? copy.failed}</p>
        <Button variant="outline" size="sm" onClick={() => props.load(true)}>{copy.retry}</Button>
      </div>}

      {state.snapshot !== undefined && view !== undefined && recent !== undefined && <>
        {state.snapshot.zoneFallback && <p className="dsh-model-usage-warning" role="status">{copy.zoneFallback} ({state.snapshot.zone})</p>}
        {state.status === 'failed' && <p className="dsh-model-usage-warning" role="alert">{state.error ?? copy.failed}</p>}
        <Overview
          view={view}
          recent={recent}
          allTime={state.snapshot.allTime}
          metric={state.metric}
          onMetric={props.setMetric}
          query={state.query}
          onQuery={props.setQuery}
        />
        <BreakdownTable
          rows={view.rows}
          totalTokens={view.totals.tokens}
          totalRequests={view.totals.requests}
          metric={state.metric}
        />
        <EffortSummary rows={view.rows} />
        <footer className="dsh-model-usage-footnote">
          <span>{copy.updated} {formatClock(state.snapshot.generatedAt)} · {state.snapshot.scanned.sessions} {copy.scanned}{state.snapshot.scanned.skipped > 0 && ` · ${state.snapshot.scanned.skipped} unreadable`}</span>
          <span>{formatDay(state.snapshot.from)} – {formatDay(state.snapshot.to)} · {copy.footnote.zone}: {state.snapshot.zone} · {copy.footnote.noCost}</span>
        </footer>
      </>}
    </div>
  </section>;
}
