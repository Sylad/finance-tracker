import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';
import { CHART_FONT_SIZE, chartTickCurrentColor, chartLegendStyle } from '@/lib/chart-theme';
import type { Loan } from '@/types/api';
import { formatEUR, formatMonth } from '@/lib/utils';
import { buildAmortizationSeries, type AmortizationPoint } from '@/lib/amortization-series';

interface Props {
  loan: Loan;
}

/**
 * Mini-graphique "capital restant prévu vs réel" pour un crédit classique
 * doté d'un tableau d'amortissement.
 *
 * "Prévu" = capitalRemaining direct du schedule (statique, banque).
 * "Réel" = computeLoanState(loan, fin du mois).estimatedFromOccurrences
 *   qui aligne chaque occurrence sur la portion `capitalPaid` de la ligne
 *   schedule du même mois (vs naïf qui soustrayait l'amount total et
 *   sous-estimait le capital restant en incluant les intérêts).
 *   Seuls les mois qui portent un prélèvement ont un point (L177) : la
 *   courbe s'arrête au dernier prélèvement connu au lieu de rester plate
 *   jusqu'à la fin du crédit, et l'infobulle d'un mois sans prélèvement
 *   n'affiche pas de valeur « Réel ».
 *   Un mois d'échéance sans prélèvement ENTRE deux prélèvements connus
 *   interrompt la courbe (L178) au lieu d'être traversé comme si le capital
 *   avait baissé normalement ; son infobulle dit qu'aucun prélèvement n'a été
 *   trouvé, et la phrase sous le graphique le cite. Un prélèvement tombé dans
 *   un mois sans échéance a son propre point (L178).
 *
 * Affiché collapsed par défaut, déplie au click.
 */
export function AmortizationChart({ loan }: Props) {
  const [open, setOpen] = useState(false);
  const schedule = loan.amortizationSchedule;

  const { points: data, lastKnownMonth } = useMemo(() => buildAmortizationSeries(loan), [loan]);
  const missingMonths = data.filter((p) => p.missing).map((p) => p.month);

  if (!schedule || schedule.length === 0) return null;

  return (
    <div className="mt-3 border-t border-border pt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-xs text-fg-muted hover:text-fg-bright transition-colors"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span className="font-display tracking-wider uppercase">Tableau d'amortissement</span>
        <span className="text-fg-dim">· {schedule.length} échéances</span>
      </button>
      {open && (
        <>
          <div className="mt-2 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="month"
                  tick={chartTickCurrentColor}
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={chartTickCurrentColor}
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                  tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
                  width={40}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    const point = payload?.[0]?.payload as AmortizationPoint | undefined;
                    return active && point ? <AmortizationTooltip point={point} /> : null;
                  }}
                />
                <Legend wrapperStyle={chartLegendStyle} />
                <Line type="monotone" dataKey="prevu" name="Prévu" stroke="#94a3b8" strokeWidth={1.5} dot={false} />
                <Line
                  type="monotone"
                  dataKey="reel"
                  name="Réel (estimé)"
                  stroke="#10b981"
                  strokeWidth={2}
                  // Pas de connectNulls (L178) : un mois sans prélèvement interrompt la courbe.
                  connectNulls={false}
                  // Un point marque le dernier prélèvement connu, là où la courbe s'arrête,
                  // et chaque bord d'interruption (un point isolé resterait sinon invisible).
                  dot={(p: { cx?: number; cy?: number; index?: number; payload?: AmortizationPoint }) =>
                    p.cx != null && p.cy != null && p.index != null && showReelDot(data, p.index, lastKnownMonth) ? (
                      <circle key={`reel-end-${p.index}`} cx={p.cx} cy={p.cy} r={3} fill="#10b981" />
                    ) : (
                      <g key={`reel-${p.index}`} />
                    )
                  }
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-xs text-fg-muted" data-testid="amortization-reel-note">
            {reelNote(lastKnownMonth, missingMonths)}
          </p>
        </>
      )}
    </div>
  );
}

/** Point visible sur la courbe Réel : dernier prélèvement, ou bord d'une interruption. */
function showReelDot(points: AmortizationPoint[], index: number, lastKnownMonth: string | null): boolean {
  const p = points[index];
  if (!p || p.reel == null) return false;
  if (p.month === lastKnownMonth) return true;
  return Boolean(points[index - 1]?.missing || points[index + 1]?.missing);
}

function reelNote(lastKnownMonth: string | null, missingMonths: string[]): string {
  if (!lastKnownMonth) return 'Réel (estimé) : aucun prélèvement détecté pour ce crédit.';
  const base = `Réel (estimé) : jusqu'au dernier prélèvement connu, ${monthLabel(lastKnownMonth)}.`;
  if (missingMonths.length === 0) return base;
  const list = missingMonths.map(monthLabel);
  const listed = list.length <= 3 ? joinFr(list) : `${joinFr(list.slice(0, 3))} et ${list.length - 3} autre${list.length - 3 > 1 ? 's' : ''}`;
  return `${base} Interrompue en ${listed} : aucun prélèvement trouvé${list.length > 1 ? ' ces mois-là' : ' ce mois-là'}.`;
}

function joinFr(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`;
}

export function AmortizationTooltip({ point }: { point: AmortizationPoint }) {
  return (
    <div
      className="rounded px-2 py-1 text-fg-bright"
      style={{ backgroundColor: 'rgba(15,23,42,0.95)', border: '1px solid rgba(148,163,184,0.2)', fontSize: CHART_FONT_SIZE }}
      data-testid="amortization-tooltip"
    >
      <p className="mb-0.5">{formatMonth(Number(point.month.slice(5, 7)), Number(point.month.slice(0, 4)))}</p>
      {point.prevu != null && (
        <p style={{ color: '#94a3b8' }}>
          Prévu : {formatEUR(point.prevu)}
          {!point.scheduled && ' (pas d’échéance ce mois)'}
        </p>
      )}
      {point.reel != null ? (
        <p style={{ color: '#10b981' }}>Réel (estimé) : {formatEUR(point.reel)}</p>
      ) : point.missing ? (
        // L178 : un trou au milieu de la courbe se dit, l'infobulle ne reste pas muette.
        <p style={{ color: '#fbbf24' }}>Réel (estimé) : aucun prélèvement trouvé ce mois-ci</p>
      ) : null}
    </div>
  );
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return formatMonth(m, y).toLowerCase();
}
