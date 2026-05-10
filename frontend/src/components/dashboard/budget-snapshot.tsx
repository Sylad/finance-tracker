import { Link } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';
import { CATEGORY_LABELS, type TransactionCategory } from '@/types/api';
import { cn } from '@/lib/utils';

export function BudgetSnapshot({
  budget,
  transactions,
}: {
  budget: Record<string, number | undefined> | undefined;
  transactions: { category: TransactionCategory; amount: number }[] | undefined;
}) {
  const items = budget && transactions ? buildItems(budget, transactions) : [];

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="stat-label">Budgets ce mois</div>
        <Link to="/budget" className="text-xs text-accent-bright hover:text-accent flex items-center gap-1 font-medium">
          Configurer <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-fg-dim italic">
          Aucun budget configuré.
        </p>
      ) : (
        <div className="space-y-3">
          {items.slice(0, 5).map((b) => (
            <div key={b.category}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-fg-muted font-medium">{b.label}</span>
                <span className={cn('tabular', b.over ? 'text-negative font-semibold' : 'text-fg-dim')}>
                  {Math.round(b.spent)} / {b.limit}€
                </span>
              </div>
              <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    b.over ? 'bg-negative' : b.pct >= 80 ? 'bg-warning' : 'bg-positive',
                  )}
                  style={{ width: `${Math.min(100, b.pct)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function buildItems(
  budget: Record<string, number | undefined>,
  transactions: { category: TransactionCategory; amount: number }[],
) {
  const spending = new Map<string, number>();
  for (const t of transactions) {
    if (t.amount < 0) spending.set(t.category, (spending.get(t.category) ?? 0) + Math.abs(t.amount));
  }
  return Object.entries(budget)
    .filter(([, l]) => typeof l === 'number' && l > 0)
    .map(([cat, limit]) => {
      const lim = limit as number;
      const spent = Math.round((spending.get(cat) ?? 0) * 100) / 100;
      const pct = Math.round((spent / lim) * 100);
      return {
        category: cat,
        label: CATEGORY_LABELS[cat as TransactionCategory] ?? cat,
        spent, limit: lim, pct,
        over: spent > lim,
      };
    })
    .sort((a, b) => b.pct - a.pct);
}
