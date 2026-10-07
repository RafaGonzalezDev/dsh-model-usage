import { useMemo } from 'react';
import type { UsageRow } from './derive.ts';
import { summarizeEffort } from './effort.ts';
import { formatCount, formatShare } from './format.ts';

/** A request distribution, deliberately separate from reasoning-token accounting. */
export function EffortSummary({ rows }: { rows: UsageRow[] }) {
  const summary = useMemo(() => summarizeEffort(rows), [rows]);
  if (summary.total === 0) return null;
  return <section className="dsh-model-usage-effort" aria-label="Reasoning effort">
    <header className="dsh-model-usage-card-head">
      <div><h2>Reasoning effort</h2><p>Configuration recorded on requests, not tokens consumed.</p></div>
      <span className="dsh-model-usage-coverage">{formatCount(summary.reported)} of {formatCount(summary.total)} reported</span>
    </header>
    {summary.reported === 0 ? <p className="dsh-model-usage-table-note">No effort recorded in the available data. It is not inferred from the model or from its tokens.</p> : <>
      <div className="dsh-model-usage-effort-list">
        {summary.entries.map(item => <div key={item.effort} className="dsh-model-usage-effort-item">
          <div><span className="dsh-model-usage-effort-name">{item.effort}</span><span>{formatShare(item.requests, summary.total)}</span></div>
          <div className="dsh-model-usage-effort-track" aria-hidden="true"><span style={{ width: `${item.requests / summary.total * 100}%` }} /></div>
          <small>{formatCount(item.requests)} requests</small>
        </div>)}
      </div>
      <p className="dsh-model-usage-table-note">{formatCount(summary.unknown)} unknown ({formatShare(summary.unknown, summary.total)}). Percentages cover every filtered request; summaries without an explicit effort are not attributed.</p>
    </>}
  </section>;
}
