import { Pencil, Trash2, ShoppingBag, Check, Circle, AlertCircle } from 'lucide-react';
import { type Loan, LOAN_CATEGORY_LABELS } from '@/types/api';
import { formatEUR, cn } from '@/lib/utils';
import { HealthChip } from './health-chip';

interface Props {
  loan: Loan;
  onEdit: () => void;
  onDelete: () => void;
}

/**
 * Card distincte pour les Loans `kind='installment'` (paiement en N fois).
 * Affiche :
 *   - Header : merchant + creditor + count×amount + date de signature
 *   - Mini-tracker : pastilles N (vert paid, gris non-due, orange retard)
 *   - Liste détaillée des échéances
 *   - HealthChip + actions edit/delete
 */
export function InstallmentCard({ loan, onEdit, onDelete }: Props) {
  const schedule = loan.installmentSchedule ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const paidCount = schedule.filter((l) => l.paid).length;
  const lateCount = schedule.filter((l) => !l.paid && l.dueDate < today).length;
  const total = schedule.reduce((s, l) => s + l.amount, 0);

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <ShoppingBag className="h-4 w-4 text-accent shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-display font-semibold text-fg-bright flex items-center gap-2 flex-wrap">
              {loan.name}
              <HealthChip loan={loan} />
            </div>
            <div className="text-xs text-fg-dim">
              {loan.installmentMerchant && <span className="uppercase tracking-wider">{loan.installmentMerchant}</span>}
              {loan.installmentMerchant && loan.creditor && <span className="mx-1">·</span>}
              {loan.creditor && <span className="uppercase tracking-wider">{loan.creditor}</span>}
            </div>
            <div className="text-xs text-fg-dim mt-0.5 tabular">
              {schedule.length}× {formatEUR(loan.monthlyPayment)} = <span className="text-fg-bright">{formatEUR(total)}</span>
              {loan.installmentSignatureDate && <span className="ml-2 text-fg-muted">· signé {loan.installmentSignatureDate}</span>}
            </div>
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          <button onClick={onEdit} className="btn-ghost p-1.5"><Pencil className="h-3.5 w-3.5" /></button>
          <button onClick={onDelete} className="btn-ghost p-1.5 hover:text-negative"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>

      {/* Mini-tracker : pastilles N */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex gap-1.5 flex-1">
          {schedule.map((line, i) => {
            const isPast = line.dueDate < today;
            const isLate = !line.paid && isPast;
            const cls = line.paid
              ? 'text-positive bg-positive/15 border-positive/40'
              : isLate
              ? 'text-warning bg-warning/15 border-warning/40 animate-pulse'
              : 'text-fg-dim bg-surface-3 border-border';
            const Icon = line.paid ? Check : isLate ? AlertCircle : Circle;
            return (
              <div
                key={i}
                title={`Échéance ${i + 1}/${schedule.length} : ${line.dueDate} · ${formatEUR(line.amount)}${line.paid ? ' ✓ payée' : isLate ? ' (en retard)' : ' (à venir)'}`}
                className={cn('w-7 h-7 rounded-full border flex items-center justify-center text-xs', cls)}
              >
                <Icon className="h-3 w-3" />
              </div>
            );
          })}
        </div>
        <span className="text-xs text-fg-muted tabular shrink-0">
          {paidCount}/{schedule.length}{lateCount > 0 ? <span className="text-warning"> · {lateCount} retard</span> : ''}
        </span>
      </div>

      {/* Liste détaillée */}
      <ul className="text-xs text-fg-muted space-y-0.5 list-none border-t border-border pt-2">
        {schedule.map((line, i) => (
          <li key={i} className="flex items-center justify-between tabular">
            <span>{i + 1}. {line.dueDate}</span>
            <span className={line.paid ? 'text-positive' : line.dueDate < today ? 'text-warning' : 'text-fg-dim'}>
              {formatEUR(line.amount)} {line.paid ? '✓' : line.dueDate < today ? '⚠ en retard' : '⌛'}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-3 text-xs text-fg-dim">
        {LOAN_CATEGORY_LABELS[loan.category]}
      </div>
    </div>
  );
}
