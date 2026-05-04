import { Link } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';
import { ScoreBadge } from '@/components/score-ring';
import type { StatementSummary } from '@/types/api';
import { formatEUR, formatMonth } from '@/lib/utils';

export function RecentStatements({ summaries }: { summaries: StatementSummary[] }) {
  return (
    <div className="card p-5 lg:col-span-2">
      <div className="flex items-center justify-between mb-4">
        <div className="stat-label">Relevés récents</div>
        <Link to="/history" className="text-xs text-accent-bright hover:text-accent flex items-center gap-1 font-medium">
          Voir tout <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="space-y-1">
        {summaries.slice(0, 5).map((s) => (
          <Link
            key={s.id}
            to="/history/$id"
            params={{ id: s.id }}
            className="flex items-center justify-between px-3 py-2.5 rounded hover:bg-surface-2 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <div className="w-1 h-9 rounded-full bg-accent-dim group-hover:bg-accent transition-colors" />
              <div>
                <div className="text-sm font-medium text-fg-bright">
                  {formatMonth(s.month, s.year)}
                </div>
                <div className="text-xs text-fg-dim">
                  {s.transactionCount} transactions · {s.bankName}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right tabular">
                <div className="text-sm text-fg">{formatEUR(s.closingBalance)}</div>
                <div className="text-xs text-fg-dim">solde</div>
              </div>
              <ScoreBadge score={s.healthScore} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
