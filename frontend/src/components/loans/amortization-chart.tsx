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
import { computeLoanState } from '@/lib/loan-state';

interface Props {
  loan: Loan;
}

/**
 * Mini-graphique "capital restant prévu vs réel" pour un crédit classique
 * doté d'un tableau d'amortissement.
 *
 * "Prévu" = capitalRemaining direct du schedule (statique, banque).
 * "Réel" = computeLoanState(loan, asOf=line.date).estimatedFromOccurrences
 *   qui aligne chaque occurrence sur la portion `capitalPaid` de la ligne
 *   schedule du même mois (vs naïf qui soustrayait l'amount total et
 *   sous-estimait le capital restant en incluant les intérêts).
 *
 * Affiché collapsed par défaut, déplie au click.
 */
export function AmortizationChart({ loan }: Props) {
  const [open, setOpen] = useState(false);
  const schedule = loan.amortizationSchedule;

  const data = useMemo(() => {
    if (!schedule || schedule.length === 0) return [];

    return schedule.map((line) => {
      // Estimé réel à la date de cette ligne : on appelle le helper qui
      // utilise la portion capitalPaid alignée. Pour chaque ligne du
      // schedule, on calcule l'état du loan à cette date.
      const stateAt = computeLoanState(loan, line.date);
      const reel = stateAt.capitalRemaining.estimatedFromOccurrences;
      // Affiche null avant la 1ère occurrence (pas de point sur la courbe
      // réelle tant qu'on n'a rien détecté).
      const reelDisplay = stateAt.totalPaid > 0 && reel != null ? Math.round(reel) : null;
      return {
        month: line.date.slice(0, 7),
        prevu: Math.round(line.capitalRemaining),
        reel: reelDisplay,
      };
    });
  }, [schedule, loan]);

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
