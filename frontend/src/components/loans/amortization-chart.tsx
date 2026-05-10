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
import type { Loan } from '@/types/api';
import { formatEUR } from '@/lib/utils';

interface Props {
  loan: Loan;
}

/**
 * Mini-graphique "capital restant prévu vs réel" pour un crédit classique
 * doté d'un tableau d'amortissement. La courbe "prévu" est l'échéancier
 * banque (statique), la courbe "réel" estime à partir des occurrences
 * détectées : capital_restant_estimé(date) ≈ initialPrincipal − sum(occurrences
 * jusqu'à date) (approximation : on attribue l'intégralité de chaque
 * mensualité au capital, ce qui sous-estime le restant ; pour un suivi
 * exact il faudrait connaître la part intérêts mois par mois).
 *
 * Affiché collapsed par défaut sur la card classique, déplie au click.
 */
export function AmortizationChart({ loan }: Props) {
  const [open, setOpen] = useState(false);
  const schedule = loan.amortizationSchedule;

  const data = useMemo(() => {
    if (!schedule || schedule.length === 0) return [];

    // Pour chaque échéance prévue, calcule l'état réel à la date :
    // initialPrincipal − somme(|amount| des occurrences avec date ≤ échéance).
    const sortedOccurrences = [...loan.occurrencesDetected]
      .map((o) => ({ date: o.date, amount: Math.abs(o.amount) }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return schedule.map((line) => {
      const cumulative = sortedOccurrences
        .filter((o) => o.date <= line.date)
        .reduce((s, o) => s + o.amount, 0);
      const realRemaining = Math.max(0, (loan.initialPrincipal ?? 0) - cumulative);
      return {
        // YYYY-MM affichage compact
        month: line.date.slice(0, 7),
        prevu: Math.round(line.capitalRemaining),
        // Real seulement si on a au moins une occurrence avant cette date
        reel: cumulative > 0 ? Math.round(realRemaining) : null,
      };
    });
  }, [schedule, loan.occurrencesDetected, loan.initialPrincipal]);

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
        <div className="mt-2 h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 9, fill: 'currentColor' }}
                tickLine={false}
                axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 9, fill: 'currentColor' }}
                tickLine={false}
                axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
                width={28}
              />
              <Tooltip
                contentStyle={{ backgroundColor: 'rgba(15,23,42,0.95)', border: '1px solid rgba(148,163,184,0.2)', fontSize: 12 }}
                formatter={(v: number) => formatEUR(v)}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="prevu" name="Prévu" stroke="#94a3b8" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="reel" name="Réel (estimé)" stroke="#10b981" strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
