import { useEffect, useMemo, useRef, useState } from 'react';
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

/**
 * Étiquettes de mois de l'axe : une par mois, posée sur la première colonne où
 * il apparaît. Un mois entamé à la toute fin d'une colonne (moins de 3 colonnes
 * avant le suivant) perd son étiquette, sinon elle écrase celle du mois suivant.
 */
export function buildMonthTicks(columns: (DayCell | null)[][]): { col: number; label: string }[] {
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
  return ticks.filter((t, i) => i === ticks.length - 1 || ticks[i + 1].col - t.col >= 3);
}

export const EMPTY_CELL_COLOR = 'hsl(220 12% 14%)';

/**
 * Couleur d'une case selon son intensité (0 = aucun débit, 1 = maximum de la
 * période). Plus on dépense, plus la case est claire et vive : sur fond sombre
 * c'est ce qui la détache de la case vide (≥ 3:1, WCAG 1.4.11).
 */
export function heatmapColor(t: number): string {
  return t <= 0 ? EMPTY_CELL_COLOR : `hsl(0, 75%, ${50 + t * 15}%)`;
}

export function SpendingHeatmap({ byDay, from, to }: Props) {
  const { columns, max, total, daysCovered } = useMemo(
    () => buildHeatmapGrid(byDay, from, to),
    [byDay, from, to],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<DayCell | null>(null);

  // La grille démarre à gauche sur le mois le plus ancien : sur un téléphone les
  // mois récents seraient hors champ. On ouvre donc sur la fin.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [columns]);

  const summary = useMemo(() => {
    let top: DayCell | null = null;
    for (const col of columns) for (const c of col) if (c && c.amount > 0 && (!top || c.amount > top.amount)) top = c;
    const base = `Heatmap des dépenses : ${daysCovered} jour${daysCovered > 1 ? 's' : ''} avec débit, total ${formatEUR(total)}`;
    return top ? `${base}. Journée la plus dépensière : ${formatDateLong(top.date)}, ${formatEUR(top.amount)}.` : `${base}.`;
  }, [columns, daysCovered, total]);

  const days = useMemo(() => columns.flat().filter((c): c is DayCell => c !== null), [columns]);

  // Un seul arrêt de tabulation sur la zone : ←/→ changent de semaine, ↑/↓ de jour.
  // Sans jour choisi, la première flèche ouvre sur le plus récent.
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[e.key];
    if (step === undefined || days.length === 0) return;
    e.preventDefault();
    const at = selected ? days.findIndex((d) => d.date === selected.date) : -1;
    const next = at < 0 ? days.length - 1 : Math.min(days.length - 1, Math.max(0, at + step));
    setSelected(days[next]);
    scrollRef.current?.querySelector(`[data-date="${days[next].date}"]`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  const monthTicks = useMemo(() => buildMonthTicks(columns), [columns]);

  function intensity(amount: number): number {
    if (max <= 0 || amount <= 0) return 0;
    // Smooth via cube-root for better visual spread (otherwise huge spikes flatten everything)
    return Math.pow(amount / max, 1 / 3);
  }

  return (
    <>
    <div
      ref={scrollRef}
      data-heatmap-scroll
      role="group"
      tabIndex={0}
      aria-label="Grille des dépenses par jour : flèches gauche et droite pour changer de semaine, haut et bas pour changer de jour"
      onKeyDown={onKeyDown}
      className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      <div className="inline-block">
        <div role="img" aria-label={summary}>
        {/* Month axis */}
        <div className="flex" style={{ paddingLeft: 22 }}>
          {columns.map((_, i) => {
            const tick = monthTicks.find((t) => t.col === i);
            return (
              <div key={i} style={{ width: 14 }} className="text-[11px] text-fg-dim h-4">
                {tick?.label ?? ''}
              </div>
            );
          })}
        </div>
        {/* Grid: 7 rows × N cols, plus weekday labels on the left */}
        <div className="flex">
          <div className="flex flex-col mr-1.5" style={{ width: 16 }}>
            {DAY_LABELS.map((d, i) => (
              <div key={i} className="h-3.5 text-[11px] text-fg-dim flex items-center" style={{ marginBottom: 2 }}>
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
                  const bg = heatmapColor(t);
                  const tip = cell.amount > 0
                    ? `${formatDateLong(cell.date)} : ${formatEUR(cell.amount)}`
                    : `${formatDateLong(cell.date)} : aucun débit`;
                  return (
                    <div
                      key={j}
                      title={tip}
                      data-date={cell.date}
                      data-selected={selected?.date === cell.date ? 'true' : undefined}
                      onClick={() => setSelected(cell)}
                      className="h-3.5 rounded-sm transition-all hover:scale-125 hover:ring-1 hover:ring-accent cursor-pointer data-[selected=true]:ring-2 data-[selected=true]:ring-accent"
                      style={{ background: bg, marginRight: 2, marginBottom: 2, width: 12 }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        </div>
      </div>
    </div>
    {/* Lecture d'une case touchée ou cliquée (le survol seul n'existe pas au toucher) */}
        <div role="status" className="mt-3 min-h-5 text-xs text-fg-muted">
          {selected
            ? `${formatDateLong(selected.date)} : ${selected.amount > 0 ? formatEUR(selected.amount) : 'aucun débit'}`
            : 'Touche ou survole une case pour lire le jour et son montant.'}
        </div>
        {/* Legend */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mt-3 text-[11px] text-fg-dim">
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
                  background: heatmapColor(t),
                }}
              />
            ))}
            Plus
          </div>
        </div>
    </>
  );
}

function formatDateLong(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
