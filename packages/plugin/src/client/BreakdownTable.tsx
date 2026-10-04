import { useMemo, useState } from 'react';
import { copy } from './copy.ts';
import { formatCount, formatDay, formatShare, formatTokens } from './format.ts';
import { groupByProvider, type ProviderGroup, type UsageMetric, type UsageRow } from './derive.ts';

type SortKey = 'name' | 'tokens' | 'requests' | 'last';

export interface BreakdownTableProps {
  rows: UsageRow[];
  totalTokens: number;
  totalRequests: number;
  metric: UsageMetric;
}

/** Reasoning coverage of one row: absent, explicitly zero or partial against its own requests. */
function ReasoningCell({ reasoning, reported, requests }: { reasoning: number; reported: number | undefined; requests: number }) {
  const known = (reported ?? 0) > 0 || reasoning > 0;
  if (!known) return <td className="dsh-model-usage-numeric" title="Sin desglose de razonamiento en los registros; no equivale a cero">—</td>;
  const partial = reported !== undefined && reported < requests;
  return <td className="dsh-model-usage-numeric" title={`${formatCount(reasoning)} tokens de razonamiento${reported === undefined ? '' : ` · ${reported} de ${requests} peticiones con desglose registrado`}`}>
    {formatTokens(reasoning)}
    {partial && <small className="dsh-model-usage-partial">parcial</small>}
  </td>;
}

function ShareBar({ value, total }: { value: number; total: number }) {
  return <div className="dsh-model-usage-share">
    <span>{formatShare(value, total)}</span>
    <span className="dsh-model-usage-share-track" aria-hidden="true">
      <span style={{ width: `${total > 0 ? Math.min(100, value / total * 100) : 0}%` }} />
    </span>
  </div>;
}

/** Provider groups with collapsible per-model rows; the window share stays visible while collapsed. */
export function BreakdownTable({ rows, totalTokens, totalRequests, metric }: BreakdownTableProps) {
  const [details, setDetails] = useState(false);
  const [chosen, setChosen] = useState<SortKey | undefined>(undefined);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const sort: SortKey = chosen ?? metric;
  const groups = useMemo(() => groupByProvider(rows, metric), [rows, metric]);
  const total = metric === 'tokens' ? totalTokens : totalRequests;
  const valueOf = (item: { tokens: number; requests: number }): number => (metric === 'tokens' ? item.tokens : item.requests);
  const compare = <T extends { tokens: number; requests: number; lastDay: string | undefined }>(a: T, b: T, name: (item: T) => string): number => {
    if (sort === 'name') return name(a).localeCompare(name(b));
    if (sort === 'last') return (a.lastDay ?? '').localeCompare(b.lastDay ?? '');
    return a[sort] - b[sort] || name(a).localeCompare(name(b));
  };
  const ordered = [...groups].sort((a, b) => -compare(a, b, group => group.provider));
  const openCount = groups.filter(group => open.has(group.provider)).length;

  const toggle = (provider: string): void => setOpen(current => {
    const next = new Set(current);
    if (!next.delete(provider)) next.add(provider);
    return next;
  });

  const head = (key: SortKey, label: string, numeric: boolean) => <th
    scope="col"
    className={numeric ? 'dsh-model-usage-numeric' : undefined}
    aria-sort={sort === key ? 'descending' : 'none'}
  >
    <button
      type="button"
      className="dsh-model-usage-sort"
      onClick={() => setChosen(current => current === key ? undefined : key)}
    >{label}<span aria-hidden="true">{sort === key ? ' ↓' : ' ↕'}</span></button>
  </th>;

  const detailHeads = details && <>
    <th scope="col" className="dsh-model-usage-numeric">{copy.breakdown.columns.input}</th>
    <th scope="col" className="dsh-model-usage-numeric">{copy.breakdown.columns.output}</th>
    <th scope="col" className="dsh-model-usage-numeric">{copy.breakdown.columns.cache}</th>
    <th scope="col" className="dsh-model-usage-numeric">{copy.breakdown.columns.reasoning}</th>
  </>;

  return <section className="dsh-model-usage-breakdown" aria-label={copy.breakdown.title}>
    <header className="dsh-model-usage-card-head">
      <div>
        <h2>{copy.breakdown.title} <span className="dsh-model-usage-count">{groups.length}</span></h2>
        <p>{metric === 'tokens' ? copy.breakdown.hintTokens : copy.breakdown.hintRequests}</p>
      </div>
      <div className="dsh-model-usage-card-actions">
        {groups.length > 1 && <button
          type="button"
          className="dsh-model-usage-quiet"
          onClick={() => setOpen(openCount === groups.length ? new Set() : new Set(groups.map(group => group.provider)))}
        >{openCount === groups.length ? copy.breakdown.collapse : copy.breakdown.expand}</button>}
        <label className="dsh-model-usage-toggle">
          <input type="checkbox" checked={details} onChange={event => setDetails(event.target.checked)} />
          {copy.breakdown.detail}
        </label>
      </div>
    </header>

    {rows.length === 0
      ? <p className="dsh-model-usage-note">{copy.empty}</p>
      : <div className="dsh-model-usage-table-wrap">
        <table className="dsh-model-usage-table">
          <caption className="dsh-model-usage-sr-only">{copy.breakdown.title}</caption>
          <thead>
            <tr>
              {head('name', copy.breakdown.columns.group, false)}
              {head('tokens', copy.breakdown.columns.tokens, true)}
              <th scope="col" className="dsh-model-usage-numeric">{copy.breakdown.columns.share}</th>
              {head('requests', copy.breakdown.columns.requests, true)}
              {detailHeads}
              {head('last', copy.breakdown.columns.last, true)}
            </tr>
          </thead>
          <tbody>
            {ordered.map(group => {
              const isOpen = open.has(group.provider);
              return [
                <tr key={group.provider} className="dsh-model-usage-group" data-open={isOpen ? 'true' : undefined} onClick={() => toggle(group.provider)}>
                  <th scope="row" className="dsh-model-usage-group-cell">
                    <button type="button" className="dsh-model-usage-disclosure" aria-expanded={isOpen}>
                      <span className="dsh-model-usage-group-name">{group.provider}</span>
                      <small>{copy.breakdown.models(group.models.length)}</small>
                    </button>
                  </th>
                  <td className="dsh-model-usage-numeric dsh-model-usage-total" title={formatCount(group.tokens)}>{formatTokens(group.tokens)}</td>
                  <td className="dsh-model-usage-numeric"><ShareBar value={valueOf(group)} total={total} /></td>
                  <td className="dsh-model-usage-numeric">{formatCount(group.requests)}</td>
                  {details && <>
                    <td className="dsh-model-usage-numeric" title={formatCount(group.input)}>{formatTokens(group.input)}</td>
                    <td className="dsh-model-usage-numeric" title={formatCount(group.output)}>{formatTokens(group.output)}</td>
                    <td className="dsh-model-usage-numeric" title={formatCount(group.cacheRead)}>{formatTokens(group.cacheRead)}</td>
                    <ReasoningCell reasoning={group.reasoning} reported={group.reasoningReported} requests={group.requests} />
                  </>}
                  <td className="dsh-model-usage-numeric dsh-model-usage-last">{group.lastDay === undefined ? '—' : formatDay(group.lastDay)}</td>
                </tr>,
                ...(isOpen ? [...group.models].sort((a, b) => -compare(a, b, row => row.series.name ?? row.series.model)).map(row => <tr key={row.series.id} className="dsh-model-usage-child">
                  <th scope="row" className="dsh-model-usage-child-cell"><span title={row.series.model}>{row.series.name ?? row.series.model}</span></th>
                  <td className="dsh-model-usage-numeric" title={formatCount(row.tokens)}>{formatTokens(row.tokens)}</td>
                  <td className="dsh-model-usage-numeric"><ShareBar value={valueOf(row)} total={total} /></td>
                  <td className="dsh-model-usage-numeric">{formatCount(row.requests)}</td>
                  {details && <>
                    <td className="dsh-model-usage-numeric" title={formatCount(row.input)}>{formatTokens(row.input)}</td>
                    <td className="dsh-model-usage-numeric" title={formatCount(row.output)}>{formatTokens(row.output)}</td>
                    <td className="dsh-model-usage-numeric" title={formatCount(row.cacheRead)}>{formatTokens(row.cacheRead)}</td>
                    <ReasoningCell reasoning={row.reasoning} reported={row.reasoningReported} requests={row.requests} />
                  </>}
                  <td className="dsh-model-usage-numeric dsh-model-usage-last">{row.lastDay === undefined ? '—' : formatDay(row.lastDay)}</td>
                </tr>) : []),
              ];
            })}
          </tbody>
        </table>
      </div>}
    {details && <p className="dsh-model-usage-table-note">{copy.breakdown.note}</p>}
  </section>;
}
