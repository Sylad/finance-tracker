import { useState } from 'react';
import { Banknote, FileUp, Pencil, Trash2, RefreshCw } from 'lucide-react';
import { useResyncLoan } from '@/lib/queries';
import { type Loan, LOAN_CATEGORY_LABELS } from '@/types/api';
import { formatEUR } from '@/lib/utils';
import { SplitButton } from './split-button';
import { ImportStatementModal } from './import-statement-modal';
import { AmortizationChart } from './amortization-chart';

export function ClassicCard({ loan, onEdit, onDelete }: { loan: Loan; onEdit: () => void; onDelete: () => void }) {
  const resync = useResyncLoan();
  const [importing, setImporting] = useState(false);
  const start = loan.startDate ? new Date(loan.startDate).getTime() : 0;
  const end = loan.endDate ? new Date(loan.endDate).getTime() : 0;
  const now = Date.now();
  const total = end - start;
  const elapsed = Math.max(0, Math.min(total, now - start));
  const pct = total > 0 ? Math.round((elapsed / total) * 100) : 0;
  const monthsRemaining = end > now ? Math.ceil((end - now) / (1000 * 60 * 60 * 24 * 30.44)) : 0;
  const occurrences = loan.occurrencesDetected.length;

  const handleResync = async () => {
    if (!confirm(`Re-scanner tous les relevés pour ${loan.name} ?`)) return;
    try {
      const res = await resync.mutateAsync({ id: loan.id });
      alert(`Re-synchronisé sur ${res.rescanned} relevé(s)`);
    } catch (e) {
      alert(`Erreur : ${(e as Error).message}`);
    }
  };

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Banknote className="h-4 w-4 text-accent" />
          <div>
            <div className="font-display font-semibold text-fg-bright">{loan.name}</div>
            <div>
              {loan.creditor && <span className="text-xs text-fg-dim uppercase tracking-wider">{loan.creditor}</span>}
              {loan.contractRef && <span className="text-xs text-fg-dim font-mono ml-2">#{loan.contractRef}</span>}
            </div>
            {loan.rumRefs && loan.rumRefs.length > 0 && (
              <div className="text-[11px] text-fg-muted font-mono mt-0.5 break-all" title="Mandats SEPA (RUM) connus pour ce crédit">
                RUM: {loan.rumRefs.join(' · ')}
              </div>
            )}
            <div className="text-xs text-fg-dim">{LOAN_CATEGORY_LABELS[loan.category]} · {formatEUR(loan.monthlyPayment)}/mois</div>
          </div>
        </div>
        <div className="flex gap-1">
          <button onClick={onEdit} className="btn-ghost p-1.5"><Pencil className="h-3.5 w-3.5" /></button>
          <button onClick={onDelete} className="btn-ghost p-1.5 hover:text-negative"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      {loan.startDate && loan.endDate ? (
        <>
          <div className="h-2 bg-surface-3 rounded-full overflow-hidden mb-2">
            <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-fg-dim">{pct}% écoulé</span>
            <span className="text-fg-bright tabular">{monthsRemaining} mois restants</span>
          </div>
          <div className="mt-2 text-xs text-fg-muted tabular">
            {occurrences} mensualité{occurrences > 1 ? 's' : ''} prélevée{occurrences > 1 ? 's' : ''}
          </div>
        </>
      ) : (
        <p className="text-xs text-fg-dim italic">Renseigne les dates de début et fin pour activer le suivi.</p>
      )}
      <SplitButton loan={loan} />
      <button
        onClick={handleResync}
        disabled={resync.isPending}
        className="btn-ghost text-xs mt-3 flex items-center gap-1"
      >
        <RefreshCw className={`h-3 w-3 ${resync.isPending ? 'animate-spin' : ''}`} />
        {resync.isPending ? 'Re-scan en cours…' : 'Re-scanner les relevés'}
      </button>
      <button
        onClick={() => setImporting(true)}
        className="btn-ghost text-xs mt-2 flex items-center gap-1"
      >
        <FileUp className="h-3 w-3" />
        Importer un relevé crédit (PDF)
      </button>
      {importing && <ImportStatementModal loan={loan} onClose={() => setImporting(false)} />}
      <AmortizationChart loan={loan} />
    </div>
  );
}
