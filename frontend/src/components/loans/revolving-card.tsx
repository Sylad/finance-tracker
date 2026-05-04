import { CreditCard, Pencil, Trash2, RefreshCw } from 'lucide-react';
import { useResetRevolving, useResyncLoan } from '@/lib/queries';
import type { Loan } from '@/types/api';
import { formatEUR, cn } from '@/lib/utils';
import { SplitButton } from './split-button';

export function RevolvingCard({ loan, onEdit, onDelete }: { loan: Loan; onEdit: () => void; onDelete: () => void }) {
  const reset = useResetRevolving();
  const resync = useResyncLoan();
  const max = loan.maxAmount ?? 0;
  const used = loan.usedAmount ?? 0;
  const pct = max > 0 ? Math.round((used / max) * 100) : 0;
  const tone = pct >= 80 ? 'bg-negative' : pct >= 50 ? 'bg-warning' : 'bg-positive';

  const handleReset = async () => {
    const v = prompt(`Solde utilisé actuel pour ${loan.name} (max ${formatEUR(max)}) :`, String(used));
    if (v == null) return;
    const n = Number(v);
    if (!Number.isFinite(n)) return alert('Valeur invalide');
    await reset.mutateAsync({ id: loan.id, usedAmount: n });
  };

  const handleResync = async () => {
    const baseline = prompt(
      `Pour re-scanner ${loan.name}, indique le solde utilisé AVANT les remboursements détectés dans tes relevés (ex : si ton revolving était à 1500€ avant les 3 mensualités importées, mets 1500) :`,
      String(loan.usedAmount ?? 0),
    );
    if (baseline === null) return;
    const n = Number(baseline);
    if (!Number.isFinite(n) || n < 0) return alert('Valeur invalide');
    try {
      const res = await resync.mutateAsync({ id: loan.id, baselineUsedAmount: n });
      alert(`Re-synchronisé sur ${res.rescanned} relevé(s)`);
    } catch (e) {
      alert(`Erreur : ${(e as Error).message}`);
    }
  };

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-warning" />
          <div>
            <div className="font-display font-semibold text-fg-bright">{loan.name}</div>
            <>{loan.creditor && <span className="text-xs text-fg-dim uppercase tracking-wider">{loan.creditor}</span>}{loan.contractRef && <span className="text-xs text-fg-dim font-mono ml-2">#{loan.contractRef}</span>}</>
            <div className="text-xs text-fg-dim">Revolving · {formatEUR(loan.monthlyPayment)}/mois</div>
          </div>
        </div>
        <div className="flex gap-1">
          <button onClick={onEdit} className="btn-ghost p-1.5"><Pencil className="h-3.5 w-3.5" /></button>
          <button onClick={onDelete} className="btn-ghost p-1.5 hover:text-negative"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <div className="h-3 bg-surface-3 rounded-full overflow-hidden mb-2">
        <div className={cn('h-full transition-all', tone)} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center justify-between text-xs tabular">
        <span className="text-fg-bright">{formatEUR(used)} utilisés</span>
        <span className="text-fg-dim">/ {formatEUR(max)} ({pct}%)</span>
      </div>
      <div className="text-xs text-fg-muted tabular mt-1">{formatEUR(max - used)} disponibles</div>
      <SplitButton loan={loan} />
      <button onClick={handleReset} className="btn-ghost text-xs mt-3">Recaler le solde</button>
      <button
        onClick={handleResync}
        disabled={resync.isPending}
        className="btn-ghost text-xs mt-2 flex items-center gap-1"
      >
        <RefreshCw className={`h-3 w-3 ${resync.isPending ? 'animate-spin' : ''}`} />
        {resync.isPending ? 'Re-scan en cours…' : 'Re-scanner les relevés'}
      </button>
    </div>
  );
}
