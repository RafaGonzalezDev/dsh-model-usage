import { copy } from './copy.ts';
import { formatCount, formatDay, formatTokens } from './format.ts';
import type { UsageMetric, UsageView } from './derive.ts';

export interface KpiRowProps {
  view: UsageView;
  metric: UsageMetric;
}

/** Quiet figures directly below the activity calendar, as in the reference. */
export function KpiRow({ view, metric }: KpiRowProps) {
  const { totals } = view;
  const peak = totals.peak;
  const format = metric === 'tokens' ? formatTokens : formatCount;
  const stats = [
    { label: metric === 'tokens' ? copy.kpi.tokens : copy.kpi.requests, value: format(totals[metric]), hint: formatCount(totals[metric]) },
    { label: copy.kpi.peak, value: format(peak?.value ?? 0), hint: peak === undefined ? copy.empty : formatDay(peak.day) },
    { label: copy.kpi.activeDays, value: formatCount(totals.activeDays), hint: copy.overview.activeDaysHint(totals.activeDays, view.days.length) },
  ];
  return <div className="dsh-model-usage-kpis" role="group" aria-label="Resumen de los últimos 30 días">
    {stats.map(stat => <div key={stat.label} className="dsh-model-usage-kpi" title={stat.hint}>
      <span className="dsh-model-usage-kpi-value">{stat.value}</span>
      <span className="dsh-model-usage-kpi-label">{stat.label}</span>
    </div>)}
  </div>;
}
