/** Native DSH surfaces and accent ramp, shared by light and dark themes. */
export const styles = `
div:has(> .dsh-model-usage-sidebar),
div:has(> div > .dsh-model-usage-sidebar) { flex-wrap: wrap; }
.dsh-model-usage-sidebar { flex: 1 0 100%; min-width: 0; min-height: 44px; display: flex; align-items: center; gap: 8px;
  box-sizing: border-box; padding: 6px; border: 0; border-radius: var(--dsw-radius-md, 8px); background: transparent;
  color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; line-height: 22px; text-align: left; cursor: pointer; }
.dsh-model-usage-sidebar:hover { background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2)); }
.dsh-model-usage-sidebar:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.dsh-model-usage-sidebar[data-wide="false"] { justify-content: center; padding: 0; min-height: 36px; width: 36px; }
.dsh-model-usage-sidebar-glyph { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 24px; width: 24px; height: 24px; color: var(--dsw-alias-label-secondary); }

.dsh-model-usage-panel { box-sizing: border-box; height: 100%; overflow: auto; padding: 48px 40px; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.5; }
.dsh-model-usage-panel * { box-sizing: border-box; }
.dsh-model-usage-content { max-width: 1080px; margin: 0 auto; display: flex; flex-direction: column; gap: 24px; }
.dsh-model-usage-header { display: flex; align-items: center; justify-content: space-between; gap: 24px; flex-wrap: wrap; margin-bottom: 4px; }
.dsh-model-usage-heading { min-width: 0; }
.dsh-model-usage-eyebrow { margin: 0 0 8px; color: var(--dsw-alias-label-secondary); font-size: 11px; font-weight: 500; letter-spacing: .07em; }
.dsh-model-usage-title { margin: 0; font-size: 28px; font-weight: 600; line-height: 1.25; letter-spacing: -.035em; }
.dsh-model-usage-subtitle { margin: 10px 0 0; color: var(--dsw-alias-label-secondary); max-width: 56ch; font-size: 13px; }
.dsh-model-usage-header-actions { display: flex; align-items: center; gap: 8px; }
.dsh-model-usage-overview, .dsh-model-usage-breakdown, .dsh-model-usage-effort { border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); padding: 24px 28px; min-width: 0; }
.dsh-model-usage-card-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; }
.dsh-model-usage-card-head h2 { margin: 0; font-size: 14px; font-weight: 600; letter-spacing: -.01em; }
.dsh-model-usage-card-head p { margin: 5px 0 0; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsh-model-usage-card-actions { display: flex; align-items: center; gap: 16px; }
.dsh-model-usage-quiet { border: 0; background: transparent; padding: 4px 0; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer; }
.dsh-model-usage-quiet:hover { color: var(--dsw-alias-label-primary); }
.dsh-model-usage-note { margin: 16px 0; color: var(--dsw-alias-label-secondary); }
.dsh-model-usage-warning { margin: 0; padding: 12px; border-left: 3px solid var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-label-secondary); }
.dsh-model-usage-failure { display: flex; align-items: center; gap: 12px; }

/* The year calendar fills the container: one square per day, month labels only. */
.dsh-model-usage-calendar { margin-top: 26px; }
.dsh-model-usage-cal-grid { display: flex; gap: 3px; }
.dsh-model-usage-cal-week { position: relative; display: flex; flex: 1 1 0; min-width: 0; flex-direction: column; gap: 3px; padding-top: 20px; }
.dsh-model-usage-cal-month { position: absolute; top: 0; left: 0; color: var(--dsw-alias-label-secondary); font-size: 10px; white-space: nowrap; }
.dsh-model-usage-cal-slot { position: relative; width: 100%; }
.dsh-model-usage-cal-cell { display: block; width: 100%; aspect-ratio: 1; padding: 0; border: 0; border-radius: 2px; background: var(--dsw-alias-bg-layer-2); }
button.dsh-model-usage-cal-cell { cursor: pointer; transition: filter .12s ease, opacity .12s ease; }
.dsh-model-usage-cal-cell[data-empty="true"] { background: transparent; }
.dsh-model-usage-cal-cell[data-level="1"] { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 22%, var(--dsw-alias-bg-layer-2)); }
.dsh-model-usage-cal-cell[data-level="2"] { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 42%, var(--dsw-alias-bg-layer-2)); }
.dsh-model-usage-cal-cell[data-level="3"] { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 66%, var(--dsw-alias-bg-layer-2)); }
.dsh-model-usage-cal-cell[data-level="4"] { background: var(--dsw-alias-brand-primary); }
button.dsh-model-usage-cal-cell:hover { filter: brightness(1.18); }
/* Elevated surface of the application itself; the lighter overlay token read as a pale popover. */
.dsh-model-usage-tip { position: absolute; z-index: 6; left: 0; bottom: calc(100% + 10px); display: flex; flex-direction: column; gap: 6px; width: 232px; padding: 12px 14px;
  background: var(--dsw-alias-bg-layer-3); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px;
  box-shadow: 0 12px 32px rgb(0 0 0 / 45%); font-size: 11px; line-height: 1.5; color: var(--dsw-alias-label-secondary);
  opacity: 0; visibility: hidden; pointer-events: none; }
.dsh-model-usage-cal-slot[data-selected="true"] { z-index: 7; }
.dsh-model-usage-cal-slot[data-selected="true"] .dsh-model-usage-tip { opacity: 1; visibility: visible; }
.dsh-model-usage-cal-slot[data-side="below"] .dsh-model-usage-tip { bottom: auto; top: calc(100% + 10px); }
.dsh-model-usage-cal-slot[data-align="end"] .dsh-model-usage-tip { left: auto; right: 0; }
.dsh-model-usage-tip strong { color: var(--dsw-alias-label-primary); font-size: 12px; font-weight: 500; }
.dsh-model-usage-tip-row { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; }
.dsh-model-usage-tip-row > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-model-usage-tip-row > span:last-child { font-variant-numeric: tabular-nums; }
.dsh-model-usage-cal-legend { display: flex; align-items: center; justify-content: flex-end; gap: 3px; margin-top: 14px; color: var(--dsw-alias-label-secondary); font-size: 10px; }
.dsh-model-usage-cal-legend > span:first-child { margin-right: 3px; }
.dsh-model-usage-cal-legend > span:last-child { margin-left: 3px; }
.dsh-model-usage-cal-legend .dsh-model-usage-cal-cell { width: 9px; height: 9px; border-radius: 2px; }

.dsh-model-usage-kpis { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 26px; padding-top: 20px; border-top: 1px solid var(--dsw-alias-border-l1); }
.dsh-model-usage-kpi { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.dsh-model-usage-kpi-label { color: var(--dsw-alias-label-secondary); font-size: 11px; }
.dsh-model-usage-kpi-value { font-size: 23px; font-weight: 500; line-height: 1.2; letter-spacing: -.04em; font-variant-numeric: tabular-nums; }

.dsh-model-usage-rail-block { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--dsw-alias-border-l1); }
.dsh-model-usage-filter-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.dsh-model-usage-search { flex: 1 1 auto; min-width: 0; max-width: 360px; font: inherit; font-size: 12px; color: inherit; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: var(--dsw-alias-bg-base); padding: 7px 10px; }
.dsh-model-usage-search::placeholder { color: var(--dsw-alias-label-secondary); }
.dsh-model-usage-search:focus, .dsh-model-usage-search:focus-visible { outline: none; border-color: var(--dsw-alias-brand-primary); }
.dsh-model-usage-clear { border: 0; background: transparent; padding: 0; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer; }
.dsh-model-usage-clear:hover { color: var(--dsw-alias-label-primary); }
.dsh-model-usage-rail { min-width: 0; }
.dsh-model-usage-rail-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.dsh-model-usage-rail-head h3 { margin: 0; font-size: 12px; font-weight: 500; }
.dsh-model-usage-rail-head span { color: var(--dsw-alias-label-secondary); font-size: 11px; }
.dsh-model-usage-rail-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px 32px; list-style: none; margin: 0; padding: 0; }
.dsh-model-usage-rail-row { display: flex; align-items: center; gap: 14px; padding: 8px; margin: 0 -8px; border-radius: 6px; }
.dsh-model-usage-rail-row:hover { background: var(--dsw-alias-bg-layer-2); }
.dsh-model-usage-rail-name { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.dsh-model-usage-rail-name strong { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-model-usage-rail-name small { color: var(--dsw-alias-label-secondary); font-size: 11px; }
.dsh-model-usage-spark { display: flex; align-items: flex-end; gap: 2px; height: 22px; flex: 0 0 96px; opacity: .7; }
.dsh-model-usage-spark > span { flex: 1 1 0; min-width: 2px; background: var(--dsw-alias-border-l2); border-radius: 1px; }
.dsh-model-usage-spark > span[data-active="true"] { background: var(--dsw-alias-label-secondary); }
.dsh-model-usage-rail-value { flex: 0 0 64px; text-align: right; font-size: 13px; font-variant-numeric: tabular-nums; }
.dsh-model-usage-rail-track { flex: 0 0 56px; height: 3px; border-radius: 2px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; }
.dsh-model-usage-rail-track > span { display: block; height: 100%; border-radius: inherit; background: var(--dsw-alias-label-secondary); }
.dsh-model-usage-rail-others { margin: 14px 0 0; font-size: 11px; color: var(--dsw-alias-label-secondary); }

.dsh-model-usage-summary-line { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--dsw-alias-border-l1); font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dsh-model-usage-summary-line span span { margin: 0 5px; }

.dsh-model-usage-count { font-size: 11px; color: var(--dsw-alias-label-secondary); margin-left: 6px; font-weight: 400; }
.dsh-model-usage-toggle { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dsh-model-usage-toggle input { accent-color: var(--dsw-alias-brand-primary); }
/* The wrap bleeds by the cell padding, so rows keep side padding without losing text alignment. */
.dsh-model-usage-table-wrap { overflow-x: auto; margin: 22px -14px 0; }
.dsh-model-usage-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.dsh-model-usage-table th, .dsh-model-usage-table td { padding: 13px 14px; text-align: left; white-space: nowrap; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dsh-model-usage-table thead th { color: var(--dsw-alias-label-secondary); font-weight: 400; padding-top: 0; padding-bottom: 12px; font-size: 11px; }
.dsh-model-usage-table tbody tr:last-child > * { border-bottom: 0; }
.dsh-model-usage-table .dsh-model-usage-numeric { text-align: right; font-variant-numeric: tabular-nums; }
.dsh-model-usage-table tbody tr > * { transition: background .12s ease; }
.dsh-model-usage-table tbody tr:hover > * { background: var(--dsw-alias-bg-layer-2); }
.dsh-model-usage-table tbody tr:hover > *:first-child { border-top-left-radius: 4px; border-bottom-left-radius: 4px; }
.dsh-model-usage-table tbody tr:hover > *:last-child { border-top-right-radius: 4px; border-bottom-right-radius: 4px; }
.dsh-model-usage-group { cursor: pointer; }
.dsh-model-usage-group > * { background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 55%, transparent); }
.dsh-model-usage-group > *:first-child { border-top-left-radius: 4px; border-bottom-left-radius: 4px; }
.dsh-model-usage-group > *:last-child { border-top-right-radius: 4px; border-bottom-right-radius: 4px; }
.dsh-model-usage-group-cell { font-weight: 500; }
.dsh-model-usage-disclosure { display: flex; align-items: baseline; gap: 8px; border: 0; background: transparent; padding: 0; color: inherit; font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; min-height: 22px; }
.dsh-model-usage-disclosure small { color: var(--dsw-alias-label-secondary); font-size: 11px; font-weight: 400; line-height: inherit; }
.dsh-model-usage-disclosure:hover .dsh-model-usage-group-name { text-decoration: underline; text-underline-offset: 3px; }
.dsh-model-usage-child-cell { font-weight: 400; color: var(--dsw-alias-label-secondary); }
.dsh-model-usage-table .dsh-model-usage-child-cell:first-child { padding-left: 30px; }
.dsh-model-usage-child-cell span { display: block; overflow: hidden; text-overflow: ellipsis; }
.dsh-model-usage-child > .dsh-model-usage-numeric { color: var(--dsw-alias-label-secondary); }
.dsh-model-usage-child .dsh-model-usage-share-track { opacity: .6; }
.dsh-model-usage-total { font-weight: 500; }
.dsh-model-usage-last { color: var(--dsw-alias-label-secondary); }
.dsh-model-usage-share { display: flex; justify-content: flex-end; align-items: center; gap: 12px; }
.dsh-model-usage-share-track { display: block; width: 64px; height: 3px; border-radius: 2px; overflow: hidden; background: var(--dsw-alias-bg-layer-2); }
.dsh-model-usage-share-track > span { display: block; height: 100%; border-radius: inherit; background: var(--dsw-alias-label-secondary); }
.dsh-model-usage-sort { border: 0; background: transparent; padding: 0; color: inherit; font: inherit; cursor: pointer; }
.dsh-model-usage-sort:hover { color: var(--dsw-alias-label-primary); }
.dsh-model-usage-sort > span { display: inline-block; min-width: 12px; }
.dsh-model-usage-partial { display: block; color: var(--dsw-alias-label-secondary); font-size: 10px; }
.dsh-model-usage-table-note { font-size: 11px; color: var(--dsw-alias-label-secondary); padding: 14px 0 0; margin: 0; }
.dsh-model-usage-coverage { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dsh-model-usage-effort-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 24px; margin-top: 24px; }
.dsh-model-usage-effort-item > div:first-child { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; }
.dsh-model-usage-effort-name { font-weight: 500; }
.dsh-model-usage-effort-item small { color: var(--dsw-alias-label-secondary); font-size: 11px; }
.dsh-model-usage-effort-track { height: 4px; background: var(--dsw-alias-bg-layer-2); border-radius: 2px; overflow: hidden; margin: 10px 0 6px; }
.dsh-model-usage-effort-track > span { display: block; height: 100%; background: var(--dsw-alias-label-secondary); border-radius: inherit; }
.dsh-model-usage-footnote { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px; color: var(--dsw-alias-label-secondary); font-size: 11px; padding: 0 2px; }
.dsh-model-usage-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.dsh-model-usage-panel :is(button, summary, [tabindex]):focus-visible,
.dsh-model-usage-panel input:not(.dsh-model-usage-search):focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) { .dsh-model-usage-panel * { transition: none !important; } }
@media (max-width: 1080px) {
  .dsh-model-usage-panel { padding: 32px 24px; }
  .dsh-model-usage-rail-list { gap: 2px 24px; }
}
@media (max-width: 900px) {
  .dsh-model-usage-rail-list { grid-template-columns: minmax(0, 1fr); }
  .dsh-model-usage-cal-grid, .dsh-model-usage-cal-week { gap: 2px; }
  .dsh-model-usage-cal-cell { border-radius: 1px; }
}
@media (max-width: 700px) {
  .dsh-model-usage-panel { padding: 24px 16px; }
  .dsh-model-usage-title { font-size: 24px; }
  .dsh-model-usage-overview, .dsh-model-usage-breakdown, .dsh-model-usage-effort { padding: 20px 16px; }
  .dsh-model-usage-table-wrap { margin-left: -10px; margin-right: -10px; }
  .dsh-model-usage-table th, .dsh-model-usage-table td { padding-left: 10px; padding-right: 10px; }
  .dsh-model-usage-spark, .dsh-model-usage-rail-track { display: none; }
  .dsh-model-usage-card-actions { flex-wrap: wrap; }
  .dsh-model-usage-kpi-value { font-size: 21px; }
  .dsh-model-usage-rail-head span { display: none; }
}
`;
