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
import { formatEURCompact, formatEURRounded, formatMonth } from '@/lib/utils';
import { buildAmortizationSeries, type AmortizationPoint } from '@/lib/amortization-series';

interface Props {
  loan: Loan;
}

/**
 * Mini-graphique "capital restant prévu vs réel" pour un crédit classique
 * doté d'un tableau d'amortissement.
 *
 * "Prévu" = capitalRemaining direct du schedule (statique, banque).
 * "Réel" = buildAmortizationSeries (lib/amortization-series.ts) : capital
 *   initial − part `capitalPaid` de l'échéance rattachée à chaque prélèvement
 *   (matchDebitsToSchedule), au mois du débit (vs naïf qui soustrayait
 *   l'amount total et sous-estimait le capital restant en incluant les
 *   intérêts).
 *   Seuls les mois qui portent un prélèvement ont un point (L177) : la
 *   courbe s'arrête au dernier prélèvement connu au lieu de rester plate
 *   jusqu'à la fin du crédit, et l'infobulle d'un mois sans prélèvement
 *   n'affiche pas de valeur « Réel ».
 *   Un mois d'échéance sans prélèvement ENTRE deux prélèvements connus
 *   interrompt la courbe (L178) au lieu d'être traversé comme si le capital
 *   avait baissé normalement ; son infobulle dit qu'aucun prélèvement n'a été
 *   trouvé, et la phrase sous le graphique le cite. Un prélèvement tombé dans
 *   un mois sans échéance a son propre point (L178).
 *   Chaque prélèvement est rattaché à UNE échéance (L180, D-1) : un
 *   prélèvement dont la date a glissé dans un mois voisin SANS prélèvement
 *   compte pour l'échéance de ce mois — pas de faux trou « aucun
 *   prélèvement » ni de courbe décalée d'une échéance. Ce mois-là n'a pas de
 *   point Réel (aucun débit), l'infobulle et la phrase disent où l'échéance a
 *   été prélevée.
 *
 * Affiché collapsed par défaut, déplie au click.
 */
export function AmortizationChart({ loan }: Props) {
  const [open, setOpen] = useState(false);
  const schedule = loan.amortizationSchedule;

  const { points: data, lastKnownMonth, unmatchedCount } = useMemo(() => buildAmortizationSeries(loan), [loan]);
  const missingMonths = data.filter((p) => p.missing).map((p) => p.month);
  const shifted = data.flatMap((p) => p.paidIn.map((paidIn) => ({ month: p.month, paidIn })));

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
                  minTickGap={12}
                  // L179 : le mois s'écrit comme dans l'infobulle et la phrase (« juillet 2026 »).
                  tickFormatter={monthLabel}
                />
                <YAxis
                  tick={chartTickCurrentColor}
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                  allowDecimals={false}
                  // L179 : graduations des autres graphiques (« 7 000 € », « 12,5 k € »).
                  tickFormatter={formatEURCompact}
                  width={64}
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
            {reelNote(lastKnownMonth, missingMonths, unmatchedCount, shifted)}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Point visible sur la courbe Réel : dernier prélèvement, ou bord d'une
 * interruption (mois sans débit entre deux mois prélevés : trou, ou échéance
 * prélevée le mois voisin) — un point isolé resterait sinon invisible.
 */
function showReelDot(points: AmortizationPoint[], index: number, lastKnownMonth: string | null): boolean {
  const p = points[index];
  if (!p || p.reel == null) return false;
  if (p.month === lastKnownMonth) return true;
  const before = points.slice(0, index).some((q) => q.reel != null);
  const after = points.slice(index + 1).some((q) => q.reel != null);
  return (points[index - 1]?.reel === null && before) || (points[index + 1]?.reel === null && after);
}

function reelNote(
  lastKnownMonth: string | null,
  missingMonths: string[],
  unmatchedCount = 0,
  shifted: { month: string; paidIn: string }[] = [],
): string {
  if (!lastKnownMonth) return 'Réel (estimé) : aucun prélèvement détecté pour ce crédit.';
  const base = `Réel (estimé) : jusqu'au dernier prélèvement connu, ${monthLabel(lastKnownMonth)}.`;
  // L180 : un prélèvement sans échéance libre à ± 1 mois compte dans les
  // mensualités prélevées mais pas dans le capital — la phrase le dit.
  const extra =
    unmatchedCount > 0
      ? ` ${unmatchedCount} prélèvement${unmatchedCount > 1 ? 's' : ''} sans échéance correspondante, non compté${unmatchedCount > 1 ? 's' : ''} dans le capital.`
      : '';
  // Revue L180 : une échéance prélevée le mois voisin n'a pas de point Réel ;
  // la phrase dit où elle a été prélevée, pour qu'on ne la croie pas manquante.
  const moved = shifted.map((s) => `${monthLabel(s.month)} prélevée en ${monthLabel(s.paidIn)}`);
  const shiftedNote =
    moved.length === 0
      ? ''
      : moved.length === 1
        ? ` Échéance ${deMois(moved[0])}.`
        : ` Échéances prélevées un autre mois : ${listFr(moved)}.`;
  if (missingMonths.length === 0) return base + shiftedNote + extra;
  const list = missingMonths.map(monthLabel);
  return `${base} Interrompue en ${listFr(list)} : aucun prélèvement trouvé${list.length > 1 ? ' ces mois-là' : ' ce mois-là'}.${shiftedNote}${extra}`;
}

/**
 * Liste en français, limitée aux trois premiers éléments : « a, b, c et
 * 2 autres » (un seul « et », L179).
 */
export function listFr(list: string[]): string {
  if (list.length <= 3) return joinFr(list);
  const rest = list.length - 3;
  return `${list.slice(0, 3).join(', ')} et ${rest} autre${rest > 1 ? 's' : ''}`;
}

function joinFr(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`;
}

export function AmortizationTooltip({ point }: { point: AmortizationPoint }) {
  return (
    <div
      className="rounded px-2 py-1 text-fg-bright"
      // Largeur bornée : à 390 px, l'infobulle débordait de l'écran (revue UX L180).
      style={{
        backgroundColor: 'rgba(15,23,42,0.95)',
        border: '1px solid rgba(148,163,184,0.2)',
        fontSize: CHART_FONT_SIZE,
        maxWidth: 220,
        whiteSpace: 'normal',
      }}
      data-testid="amortization-tooltip"
    >
      <p className="mb-0.5">{monthLabel(point.month)}</p>
      {/* L179 : euros entiers, comme les valeurs arrondies du graphique (invariant 2). */}
      {point.prevu != null ? (
        <p style={{ color: '#94a3b8' }}>
          Prévu : {formatEURRounded(point.prevu)}
          {!point.scheduled && ' (pas d’échéance ce mois)'}
        </p>
      ) : (
        // L179 : prélèvement avant la 1re échéance — pas de capital prévu, on le dit.
        !point.scheduled && <p style={{ color: '#94a3b8' }}>Prévu : pas d’échéance ce mois</p>
      )}
      {point.reel != null ? (
        <p style={{ color: '#10b981' }}>Réel (estimé) : {formatEURRounded(point.reel)}</p>
      ) : point.missing ? (
        // L178 : un trou au milieu de la courbe se dit, l'infobulle ne reste pas muette.
        <p style={{ color: '#fbbf24' }}>Réel (estimé) : aucun prélèvement trouvé ce mois-là</p>
      ) : null}
      {/* L180 : prélèvement décalé d'un mois, rattaché à l'échéance restée vide. */}
      {point.paidIn.length > 0 && (
        <p className="text-fg-muted">Échéance prélevée en {joinFr(point.paidIn.map(monthLabel))}</p>
      )}
      {point.countedFor.length > 0 && (
        <p className="text-fg-muted">Prélèvement compté pour l’échéance {deMois(joinFr(point.countedFor.map(monthLabel)))}</p>
      )}
    </div>
  );
}

/** « de mars 2026 », « d’août 2026 » (élision devant voyelle). */
export function deMois(label: string): string {
  return /^[aeiouyàâéèêîôûœ]/i.test(label) ? `d’${label}` : `de ${label}`;
}

/** Le mois d'un point, écrit d'une seule façon (axe, infobulle, phrase) : « juillet 2026 ». */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return formatMonth(m, y).toLowerCase();
}
