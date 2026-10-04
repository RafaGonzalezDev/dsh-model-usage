import { SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives';
import { Heatmap } from './Heatmap.tsx';
import { KpiRow } from './KpiRow.tsx';
import { ModelRail } from './ModelRail.tsx';
import { copy } from './copy.ts';
import type { RecentView, UsageMetric, UsageView } from './derive.ts';
import { formatCount, formatDay, formatTokens } from './format.ts';

export interface OverviewProps {
  view: UsageView;
  recent: RecentView;
  allTime: { tokens: number; requests: number };
  metric: UsageMetric;
  onMetric(metric: UsageMetric): void;
  query: string;
  onQuery(query: string): void;
}

const metricOptions = [{ value: 'tokens', label: copy.metric.tokens }, { value: 'requests', label: copy.metric.requests }];

/** One container for the whole overview: the year calendar, its figures and the models that fill it. */
export function Overview(props: OverviewProps) {
  const { recent, metric, query } = props;
  const peak = recent.models.reduce((max, model) => Math.max(max, metric === 'tokens' ? model.tokens : model.requests), 0);
  const first = recent.days[0];
  const last = recent.days[recent.days.length - 1];

  return <section className="dsh-model-usage-overview" aria-label={copy.overview.title}>
    <header className="dsh-model-usage-card-head">
      <div>
        <h2>{copy.overview.title}</h2>
        <p>{first === undefined || last === undefined ? copy.empty : `${formatDay(first)} – ${formatDay(last)}`}</p>
      </div>
      <SegmentedControl
        id="dsh-model-usage-metric"
        label={copy.metricLabel}
        value={metric}
        options={metricOptions}
        onChange={next => props.onMetric(next as UsageMetric)}
      />
    </header>

    <Heatmap
      days={recent.days}
      dayList={recent.dayList}
      values={recent.dayList.map(day => day.value)}
      cuts={recent.cuts}
      metric={metric}
    />

    <KpiRow view={props.view} metric={metric} />

    <div className="dsh-model-usage-rail-block">
      <div className="dsh-model-usage-filter-bar">
        <input
          className="dsh-model-usage-search"
          type="search"
          value={query}
          aria-label={copy.filters.label}
          placeholder={copy.filters.search}
          onChange={event => props.onQuery(event.target.value)}
        />
        {query !== '' && <button type="button" className="dsh-model-usage-clear" onClick={() => props.onQuery('')}>{copy.filters.clear}</button>}
      </div>
      <ModelRail
        models={recent.models}
        monthKeys={recent.monthKeys}
        metric={metric}
        others={recent.others}
        peak={peak}
        emptyMessage={query === '' ? copy.empty : copy.filters.empty}
      />
    </div>

    <div className="dsh-model-usage-summary-line">
      <span>{formatCount(props.view.totals.requests)} peticiones <span aria-hidden="true">·</span> {props.view.totals.models} modelos <span aria-hidden="true">·</span> {props.view.totals.providers} proveedores</span>
      <span title={copy.overview.historyHint}>Histórico: {formatTokens(props.allTime.tokens)} tokens</span>
    </div>
  </section>;
}
