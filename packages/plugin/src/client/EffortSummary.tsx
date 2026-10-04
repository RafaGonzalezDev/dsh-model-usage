import { useMemo } from 'react';
import type { UsageRow } from './derive.ts';
import { summarizeEffort } from './effort.ts';
import { formatCount, formatShare } from './format.ts';

/** A request distribution, deliberately separate from reasoning-token accounting. */
export function EffortSummary({ rows }: { rows: UsageRow[] }) {
  const summary = useMemo(() => summarizeEffort(rows), [rows]);
  if (summary.total === 0) return null;
  return <section className="dsh-model-usage-effort" aria-label="Esfuerzo de razonamiento">
    <header className="dsh-model-usage-card-head">
      <div><h2>Esfuerzo de razonamiento</h2><p>Configuración registrada en las peticiones, no tokens consumidos.</p></div>
      <span className="dsh-model-usage-coverage">{formatCount(summary.reported)} de {formatCount(summary.total)} con dato</span>
    </header>
    {summary.reported === 0 ? <p className="dsh-model-usage-table-note">Sin esfuerzo registrado en los datos disponibles. No se infiere a partir del modelo ni de sus tokens.</p> : <>
      <div className="dsh-model-usage-effort-list">
        {summary.entries.map(item => <div key={item.effort} className="dsh-model-usage-effort-item">
          <div><span className="dsh-model-usage-effort-name">{item.effort}</span><span>{formatShare(item.requests, summary.total)}</span></div>
          <div className="dsh-model-usage-effort-track" aria-hidden="true"><span style={{ width: `${item.requests / summary.total * 100}%` }} /></div>
          <small>{formatCount(item.requests)} peticiones</small>
        </div>)}
      </div>
      <p className="dsh-model-usage-table-note">{formatCount(summary.unknown)} sin dato ({formatShare(summary.unknown, summary.total)}). Porcentajes sobre todas las peticiones filtradas; los resúmenes sin esfuerzo explícito no se atribuyen.</p>
    </>}
  </section>;
}
