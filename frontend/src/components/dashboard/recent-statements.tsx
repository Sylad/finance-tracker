import { Link } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';
import { ScoreBadge } from '@/components/score-ring';
import type { StatementSummary } from '@/types/api';
import { cn, formatEUR, formatMonth } from '@/lib/utils';

export function RecentStatements({ summaries }: { summaries: StatementSummary[] }) {
  return (
    <div className="card p-4 md:p-5 lg:col-span-2">
      <div className="flex items-center justify-between mb-4">
        <div className="stat-label">Relevés récents</div>
        <Link to="/history" className="text-xs text-accent-bright hover:text-accent flex items-center gap-1 font-medium">
          Voir tout <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="space-y-1">
        {summaries.slice(0, 5).map((s, i) => (
          <Link
            key={s.id}
            to="/history/$id"
            params={{ id: s.id }}
            // Téléphone : 3 relevés, 5 à partir de md (L21/t8).
            className={cn(
              'items-center justify-between gap-3 px-2 sm:px-3 py-2.5 rounded hover:bg-surface-2 transition-colors group',
              i < 3 ? 'flex' : 'hidden md:flex',
            )}
          >
            {/* gap-3 + min-w-0 : libellé et montant ne se touchent plus à 320 px (L21/t13). */}
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="w-1 h-9 shrink-0 rounded-full bg-accent-dim group-hover:bg-accent transition-colors" />
              <div className="min-w-0">
                <div className="text-sm font-medium text-fg-bright" data-stmt-label>
                  {formatMonth(s.month, s.year)}
                </div>
                <div className="text-xs text-fg-dim">
                  {s.transactionCount} transactions<span className="hidden sm:inline"> · {s.bankName}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-4 shrink-0">
              <div className="text-right tabular">
                <div className="text-sm text-fg whitespace-nowrap" data-stmt-amount>{formatEUR(s.closingBalance)}</div>
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
