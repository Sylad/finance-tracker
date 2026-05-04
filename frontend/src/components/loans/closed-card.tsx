import { Pencil, Trash2 } from 'lucide-react';
import { type Loan, LOAN_CATEGORY_LABELS } from '@/types/api';
import { formatEUR } from '@/lib/utils';
import { SplitButton } from './split-button';

export function ClosedCard({ loan, onEdit, onDelete }: { loan: Loan; onEdit: () => void; onDelete: () => void }) {
  const lastOcc = [...loan.occurrencesDetected].sort((a, b) => b.date.localeCompare(a.date))[0];
  const totalRepaid = loan.occurrencesDetected.reduce((s, o) => s + Math.abs(o.amount), 0);
  return (
    <div className="card p-5 border-l-4 border-l-negative opacity-80">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-negative shrink-0 mt-1.5" />
          <div>
            <div className="font-display font-semibold text-fg-bright">{loan.name}</div>
            <>{loan.creditor && <span className="text-xs text-fg-dim uppercase tracking-wider">{loan.creditor}</span>}{loan.contractRef && <span className="text-xs text-fg-dim font-mono ml-2">#{loan.contractRef}</span>}</>
            <div className="text-xs text-fg-dim">Terminé · {LOAN_CATEGORY_LABELS[loan.category]}</div>
          </div>
        </div>
        <div className="flex gap-1">
          <button onClick={onEdit} className="btn-ghost p-1.5"><Pencil className="h-3.5 w-3.5" /></button>
          <button onClick={onDelete} className="btn-ghost p-1.5 hover:text-negative"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <div className="text-xs text-fg-muted tabular space-y-0.5">
        <div>{loan.occurrencesDetected.length} mensualité{loan.occurrencesDetected.length > 1 ? 's' : ''} prélevée{loan.occurrencesDetected.length > 1 ? 's' : ''}</div>
        <div>Total remboursé estimé : <span className="text-fg-bright">{formatEUR(totalRepaid)}</span></div>
        {lastOcc && <div>Dernière mensualité : {lastOcc.date}</div>}
      </div>
      <SplitButton loan={loan} />
    </div>
  );
}
