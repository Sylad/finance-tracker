import { Zap } from 'lucide-react';
import type { Loan } from '@/types/api';
import { formatEUR } from '@/lib/utils';
import { earlyRepayments } from './utils';

/**
 * Remboursements anticipés d'un crédit, distincts de l'historique de
 * mensualités (ils n'entrent dans aucune moyenne). Rien n'est rendu s'il n'y
 * en a pas.
 */
export function EarlyRepaymentsList({ loan }: { loan: Loan }) {
  const items = earlyRepayments(loan);
  if (items.length === 0) return null;
  const total = items.reduce((s, o) => s + Math.abs(o.amount), 0);
  return (
    <div className="mt-2 rounded-md border border-positive/30 bg-positive/5 px-2.5 py-1.5 text-xs">
      <div className="flex items-center gap-1 text-positive font-medium">
        <Zap className="h-3 w-3" />
        Remboursement{items.length > 1 ? 's' : ''} anticipé{items.length > 1 ? 's' : ''} · {formatEUR(total)}
      </div>
      <ul className="mt-1 space-y-0.5 text-fg-dim tabular">
        {items.map((o) => (
          <li key={o.id} className="flex justify-between gap-2">
            <span>{new Date(o.date + 'T00:00:00').toLocaleDateString('fr-FR')}</span>
            <span className="text-fg-bright">−{formatEUR(Math.abs(o.amount))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
