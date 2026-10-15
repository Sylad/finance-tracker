import { Link } from '@tanstack/react-router';
import { ArrowRight, Tags } from 'lucide-react';
import type { Transaction } from '@/types/api';
import { categorizationQuality } from '@/lib/categorization-quality';
import { formatEUR, cn } from '@/lib/utils';

/**
 * Qualité de catégorisation d'un relevé (L74) : part des transactions restées
 * en « Autres » et marchands non classés les plus fréquents. Sur le tableau de
 * bord, `statementId` fait de la tuile un lien vers le relevé.
 */
export function CategorizationQualityCard({
  transactions,
  statementId,
  className,
}: {
  transactions: Transaction[] | undefined;
  statementId?: string;
  className?: string;
}) {
  if (!transactions || transactions.length === 0) return null;
  const q = categorizationQuality(transactions);
  const percent = Math.round(q.rate * 100);
  const tone = percent >= 30 ? 'text-negative' : percent >= 15 ? 'text-warning' : 'text-positive';

  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="stat-label flex items-center gap-1.5">
          <Tags className="h-3 w-3" /> Transactions sans catégorie
        </div>
        {statementId && <ArrowRight className="h-3.5 w-3.5 text-fg-dim" aria-hidden="true" />}
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className={cn('font-display tabular font-semibold tracking-tight text-[22px] leading-tight', tone)}>
          {percent} %
        </span>
        <span className="text-xs text-fg-muted">
          {q.otherCount} transaction{q.otherCount > 1 ? 's' : ''} sur {q.total} classée{q.otherCount > 1 ? 's' : ''} « Autres »
        </span>
      </div>
      {q.topMerchants.length === 0 ? (
        <p className="mt-3 text-sm text-fg-muted">
          {q.otherCount === 0
            ? 'Toutes les transactions sont classées.'
            : 'Aucun débit à classer parmi les « Autres ».'}
        </p>
      ) : (
        <>
          <div className="mt-3 text-xs text-fg-muted">Marchands à classer</div>
          <ul className="mt-1.5 space-y-1.5">
            {q.topMerchants.map((m) => (
              <li key={m.label} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-fg-bright">{m.label}</span>
                <span className="shrink-0 text-xs text-fg-muted tabular">
                  {m.count} fois · {formatEUR(m.total)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );

  if (statementId) {
    return (
      <Link to="/history/$id" params={{ id: statementId }} className={cn('card p-5 card-hover block', className)}>
        {body}
      </Link>
    );
  }
  return <section className={cn('card p-5', className)}>{body}</section>;
}
