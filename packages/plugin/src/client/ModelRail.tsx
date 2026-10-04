import { copy } from './copy.ts';
import { formatCount, formatTokens } from './format.ts';
import type { RecentModel, UsageMetric } from './derive.ts';

export interface ModelRailProps {
  models: RecentModel[];
  /** Ascending `YYYY-MM` keys the monthly sparkline is aligned with. */
  monthKeys: string[];
  metric: UsageMetric;
  others: { models: number; tokens: number; requests: number } | undefined;
  /** Heaviest model of the window, used to scale every share bar. */
  peak: number;
  /** Shown when nothing survives the query. */
  emptyMessage: string;
}

const MONTH_LABEL = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** The models that carried the window, with their monthly shape and share of the total. */
export function ModelRail({ models, monthKeys, metric, others, peak, emptyMessage }: ModelRailProps) {
  const valueOf = (model: RecentModel): number => (metric === 'tokens' ? model.tokens : model.requests);
  const format = (value: number): string => (metric === 'tokens' ? formatTokens(value) : formatCount(value));
  return <div className="dsh-model-usage-rail">
    <div className="dsh-model-usage-rail-head">
      <h3>{copy.overview.rail}</h3>
      <span>{copy.overview.railHint}</span>
    </div>
    {models.length === 0 && <p className="dsh-model-usage-note">{emptyMessage}</p>}
    <ol className="dsh-model-usage-rail-list">
      {models.map(model => {
        const value = valueOf(model);
        const top = Math.max(...model.months, 0);
        return <li key={model.series.id}>
          <div className="dsh-model-usage-rail-row">
            <span className="dsh-model-usage-rail-name">
              <strong title={model.series.model}>{model.series.name ?? model.series.model}</strong>
              <small>{model.series.provider}</small>
            </span>
            <span className="dsh-model-usage-spark" aria-hidden="true">
              {model.months.map((month, index) => <span
                key={index}
                title={monthKeys[index] === undefined ? undefined : `${MONTH_LABEL.format(new Date(`${monthKeys[index]}-01T12:00:00Z`))}: ${format(month)}`}
                data-active={month > 0 ? 'true' : undefined}
                style={{ height: top > 0 ? `${Math.max(10, Math.round(month / top * 100))}%` : '10%' }}
              />)}
            </span>
            <span className="dsh-model-usage-rail-value">{format(value)}</span>
            <span className="dsh-model-usage-rail-track" aria-hidden="true">
              <span style={{ width: `${peak > 0 ? Math.max(2, Math.round(value / peak * 100)) : 0}%` }} />
            </span>
          </div>
        </li>;
      })}
    </ol>
    {others !== undefined && <p className="dsh-model-usage-rail-others">
      {copy.overview.others(others.models)} · {format(metric === 'tokens' ? others.tokens : others.requests)}
    </p>}
  </div>;
}
