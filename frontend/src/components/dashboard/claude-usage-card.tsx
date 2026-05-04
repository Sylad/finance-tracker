import { Sparkles } from 'lucide-react';
import type { ClaudeUsage } from '@/types/api';
import { cn } from '@/lib/utils';

export function ClaudeUsageCard({ usage }: { usage: ClaudeUsage }) {
  const remainingPct = usage.remainingPercent ?? null;
  const tone = remainingPct == null ? 'neutral'
    : remainingPct > 50 ? 'positive'
    : remainingPct > 20 ? 'warning'
    : 'negative';
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="stat-label flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" /> Budget Claude · {usage.calls} appels ce mois
          </div>
          <div className="mt-2 flex items-baseline gap-3">
            <div className="font-display text-display-md font-bold tabular text-fg-bright">
              {usage.estimatedCostEur.toFixed(2)}€
            </div>
            <div className="text-fg-dim text-sm tabular">/ {usage.budgetEur}€</div>
          </div>
        </div>
        {usage.hasBalance && usage.estimatedRemainingEur != null && (
          <div className="text-right">
            <div className="stat-label">Solde restant</div>
            <div className={cn(
              'font-display text-xl font-semibold tabular mt-1',
              tone === 'positive' && 'text-positive',
              tone === 'warning' && 'text-warning',
              tone === 'negative' && 'text-negative',
              tone === 'neutral' && 'text-fg-bright',
            )}>
              {usage.estimatedRemainingEur.toFixed(2)}€
            </div>
            <div className="text-xs text-fg-dim tabular">{remainingPct}% du crédit</div>
          </div>
        )}
      </div>
      <div className="mt-4 h-1.5 bg-surface-3 rounded-full overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            usage.percent >= 90 ? 'bg-negative' : usage.percent >= 70 ? 'bg-warning' : 'bg-accent',
          )}
          style={{ width: `${Math.min(100, usage.percent)}%` }}
        />
      </div>
    </div>
  );
}
