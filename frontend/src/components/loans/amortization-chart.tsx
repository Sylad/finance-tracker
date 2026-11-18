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
import { buildAmortizationSeries } from '@/lib/amortization-series';

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
 *
 * Affiché collapsed par défaut, déplie au click.
 */
export function AmortizationChart({ loan }: Props) {
  const [open, setOpen] = useState(false);
  const schedule = loan.amortizationSchedule;

  const { points: data, lastKnownMonth } = useMemo(() => buildAmortizationSeries(loan), [loan]);

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
                  contentStyle={{ backgroundColor: 'rgba(15,23,42,0.95)', border: '1px solid rgba(148,163,184,0.2)', fontSize: CHART_FONT_SIZE }}
                  formatter={(v: number) => formatEUR(v)}
                  // Un mois sans prélèvement porte `reel: null` : pas de ligne « Réel » inventée.
                  filterNull
                />
                <Legend wrapperStyle={chartLegendStyle} />
                <Line type="monotone" dataKey="prevu" name="Prévu" stroke="#94a3b8" strokeWidth={1.5} dot={false} />
                <Line
                  type="monotone"
                  dataKey="reel"
                  name="Réel (estimé)"
                  stroke="#10b981"
                  strokeWidth={2}
                  connectNulls
                  // Un point marque le dernier prélèvement connu, là où la courbe s'arrête.
                  dot={(p: { cx?: number; cy?: number; index?: number; payload?: { month: string } }) =>
                    p.payload?.month === lastKnownMonth && p.cx != null && p.cy != null ? (
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
            {lastKnownMonth
              ? `Réel (estimé) : jusqu'au dernier prélèvement connu, ${monthLabel(lastKnownMonth)}.`
              : 'Réel (estimé) : aucun prélèvement détecté pour ce crédit.'}
          </p>
        </>
      )}
    </div>
  );
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return formatMonth(m, y).toLowerCase();
}
