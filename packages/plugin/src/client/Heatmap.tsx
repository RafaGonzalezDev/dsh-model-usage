import { useState, type KeyboardEvent } from 'react';
import { levelOf, weekdayIndex } from '../calendar.ts';
import { copy } from './copy.ts';
import { formatCount, formatDay, formatTokens } from './format.ts';
import type { RecentDay, UsageMetric } from './derive.ts';

export interface HeatmapProps {
  days: string[];
  dayList: RecentDay[];
  values: number[];
  cuts: readonly [number, number, number] | undefined;
  metric: UsageMetric;
}

const MONTH = new Intl.DateTimeFormat('es-ES', { month: 'short', timeZone: 'UTC' });

/** One square per day across the whole window; arrow keys traverse real days, not padding. */
export function Heatmap({ days, dayList, values, cuts, metric }: HeatmapProps) {
  const [selected, setSelected] = useState<number | undefined>();
  const [cursor, setCursor] = useState(0);
  const leading = days.length === 0 ? 0 : weekdayIndex(days[0] ?? '');
  const slots: (number | undefined)[] = Array.from({ length: leading }, () => undefined);
  days.forEach((_, index) => slots.push(index));
  while (slots.length % 7 !== 0) slots.push(undefined);
  const weeks: (number | undefined)[][] = [];
  for (let at = 0; at < slots.length; at += 7) weeks.push(slots.slice(at, at + 7));
  let previousMonth = '';
  const months = weeks.map(week => {
    const index = week.find(day => day !== undefined);
    const day = index === undefined ? '' : days[index] ?? '';
    const month = day.slice(0, 7);
    const label = month && month !== previousMonth ? MONTH.format(new Date(`${day}T12:00:00Z`)) : '';
    previousMonth = month;
    return label;
  });
  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[event.key];
    if (event.key === 'Escape') { setSelected(undefined); return; }
    if (delta === undefined && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? days.length - 1 : Math.max(0, Math.min(days.length - 1, index + (delta ?? 0)));
    setCursor(next);
    event.currentTarget.closest('.dsh-model-usage-cal-grid')?.querySelector<HTMLButtonElement>(`[data-day-index="${next}"]`)?.focus();
  };

  return <div className="dsh-model-usage-calendar">
      <div className="dsh-model-usage-cal-grid" role="group" aria-label={`${copy.overview.title}: actividad diaria`}>
        {weeks.map((week, weekIndex) => <div key={weekIndex} className="dsh-model-usage-cal-week">
          <span className="dsh-model-usage-cal-month" aria-hidden="true">{months[weekIndex]}</span>
          {week.map((dayIndex, row) => {
            if (dayIndex === undefined) return <span key={row} className="dsh-model-usage-cal-cell" data-empty="true" aria-hidden="true" />;
            const day = days[dayIndex] ?? '';
            const detail = dayList[dayIndex];
            const value = values[dayIndex] ?? 0;
            const label = `${formatDay(day)}: ${formatTokens(detail?.tokens ?? 0)} tokens, ${formatCount(detail?.requests ?? 0)} peticiones`;
            return <div key={row} className="dsh-model-usage-cal-slot"
              data-side={row < 3 ? 'below' : 'above'}
              data-align={weekIndex * 2 >= weeks.length ? 'end' : undefined}
              data-selected={selected === dayIndex ? 'true' : undefined}
              onPointerEnter={() => setSelected(dayIndex)} onPointerLeave={() => setSelected(undefined)}>
              <button type="button" className="dsh-model-usage-cal-cell"
                data-day-index={dayIndex} data-level={levelOf(value, cuts)}
                aria-label={label} aria-describedby={selected === dayIndex ? `usage-day-${dayIndex}` : undefined}
                tabIndex={cursor === dayIndex ? 0 : -1}
                onFocus={() => { setCursor(dayIndex); setSelected(dayIndex); }} onBlur={() => setSelected(undefined)}
                onClick={() => setSelected(dayIndex)}
                onKeyDown={event => navigate(event, dayIndex)} />
              <span id={`usage-day-${dayIndex}`} className="dsh-model-usage-tip" role="tooltip">
                <strong>{formatDay(day)}</strong>
                <span>{formatTokens(detail?.tokens ?? 0)} tokens · {formatCount(detail?.requests ?? 0)} peticiones</span>
                {(detail?.contributors ?? []).map(item => <span key={`${item.provider}\u0000${item.model}`} className="dsh-model-usage-tip-row">
                  <span>{item.name ?? item.model}</span>
                  <span>{metric === 'tokens' ? formatTokens(item.tokens) : formatCount(item.requests)}</span>
                </span>)}
              </span>
            </div>;
          })}
        </div>)}
      </div>
      <div className="dsh-model-usage-cal-legend" aria-hidden="true">
        <span>{copy.legend.less}</span>
        {[0, 1, 2, 3, 4].map(level => <span key={level} className="dsh-model-usage-cal-cell" data-level={level} />)}
        <span>{copy.legend.more}</span>
      </div>
  </div>;
}
