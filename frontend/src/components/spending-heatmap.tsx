import { useMemo } from 'react';
import { formatEUR } from '@/lib/utils';

export interface DayCell {
  date: string;          // YYYY-MM-DD
  amount: number;        // total absolute debits that day (>= 0)
}

interface Props {
  /** Map of YYYY-MM-DD → total debit amount (positive). */
  byDay: Map<string, number>;
  /** Inclusive range to display. */
  from: Date;
  to: Date;
}

const DAY_LABELS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const MONTH_LABELS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface HeatmapGrid {
  columns: (DayCell | null)[][];
  max: number;
  total: number;
  daysCovered: number;
}

/**
 * Pure reducer: builds the heatmap grid (Monday-anchored weeks, padded with
 * nulls before `from` and after `to`) plus aggregates (max, total, days with
 * spend). Exported for unit testing.
 */
export function buildHeatmapGrid(byDay: Map<string, number>, from: Date, to: Date): HeatmapGrid {
  const cells: (DayCell | null)[][] = [];
  const start = new Date(from);
  // Monday-anchored ISO weekday (0..6 = Mon..Sun)
  const isoWeekday = (start.getDay() + 6) % 7;
  let week: (DayCell | null)[] = Array(isoWeekday).fill(null);
  let currentMax = 0;
  let total = 0;
  let daysWithSpend = 0;
  for (let d = new Date(start); d <= to; d.setDate(d.getDate() + 1)) {
    const key = dateKey(d);
    const amount = byDay.get(key) ?? 0;
    week.push({ date: key, amount });
    if (amount > currentMax) currentMax = amount;
    if (amount > 0) { total += amount; daysWithSpend++; }
    if (week.length === 7) { cells.push(week); week = []; }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    cells.push(week);
  }
  return { columns: cells, max: currentMax, total, daysCovered: daysWithSpend };
}

export function SpendingHeatmap({ byDay, from, to }: Props) {
  const { columns, max, total, daysCovered } = useMemo(
    () => buildHeatmapGrid(byDay, from, to),
    [byDay, from, to],
  );

  // Find label positions: for each column, if its first cell starts a new month, label it
  const monthTicks = useMemo(() => {
    const ticks: { col: number; label: string }[] = [];
    let lastMonth = -1;
    columns.forEach((col, i) => {
      const firstReal = col.find((c) => c) as DayCell | undefined;
      if (!firstReal) return;
      const m = Number(firstReal.date.slice(5, 7)) - 1;
      if (m !== lastMonth) {
        ticks.push({ col: i, label: MONTH_LABELS[m] });
        lastMonth = m;
      }
    });
    return ticks;
  }, [columns]);

  function intensity(amount: number): number {
    if (max <= 0 || amount <= 0) return 0;
    // Smooth via cube-root for better visual spread (otherwise huge spikes flatten everything)
    return Math.pow(amount / max, 1 / 3);
  }

  return (
    <div className="overflow-x-auto">
      <div className="inline-block">
        {/* Month axis */}
        <div className="flex" style={{ paddingLeft: 22 }}>
          {columns.map((_, i) => {
            const tick = monthTicks.find((t) => t.col === i);
            return (
              <div key={i} style={{ width: 14 }} className="text-[10px] text-fg-dim h-4">
                {tick?.label ?? ''}
              </div>
            );
          })}
        </div>
        {/* Grid: 7 rows × N cols, plus weekday labels on the left */}
        <div className="flex">
          <div className="flex flex-col mr-1.5" style={{ width: 16 }}>
            {DAY_LABELS.map((d, i) => (
              <div key={i} className="h-3.5 text-[9px] text-fg-dim flex items-center" style={{ marginBottom: 2 }}>
                {i % 2 === 1 ? d : ''}
              </div>
            ))}
          </div>
          <div className="flex">
            {columns.map((col, i) => (
              <div key={i} className="flex flex-col" style={{ width: 14 }}>
                {col.map((cell, j) => {
                  if (!cell) return <div key={j} className="h-3.5" style={{ marginBottom: 2 }} />;
                  const t = intensity(cell.amount);
                  const bg = t === 0
                    ? 'hsl(220 12% 14%)'
                    : `hsl(0, 75%, ${Math.max(20, 70 - t * 50)}%)`;
                  const tip = cell.amount > 0
                    ? `${formatDateLong(cell.date)} : ${formatEUR(cell.amount)}`
                    : `${formatDateLong(cell.date)} : aucun débit`;
                  return (
                    <div
                      key={j}
                      title={tip}
                      className="h-3.5 rounded-sm transition-all hover:scale-125 hover:ring-1 hover:ring-accent cursor-default"
                      style={{ background: bg, marginRight: 2, marginBottom: 2, width: 12 }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        {/* Legend */}
        <div className="flex items-center justify-between mt-3 text-[10px] text-fg-dim">
          <div>
            {daysCovered} jour{daysCovered > 1 ? 's' : ''} avec débit · total {formatEUR(total)}
          </div>
          <div className="flex items-center gap-1.5">
            Moins
            {[0, 0.2, 0.4, 0.6, 0.8, 1].map((t, i) => (
              <div
                key={i}
                className="rounded-sm"
                style={{
                  width: 10, height: 10,
                  background: t === 0 ? 'hsl(220 12% 14%)' : `hsl(0, 75%, ${Math.max(20, 70 - t * 50)}%)`,
                }}
              />
            ))}
            Plus
          </div>
        </div>
      </div>
    </div>
  );
}

function formatDateLong(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
