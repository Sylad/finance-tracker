import { Split } from 'lucide-react';
import { useSplitLoanByAmount } from '@/lib/queries';
import type { Loan } from '@/types/api';
import { detectAmountGroups } from './utils';

export function SplitButton({ loan }: { loan: Loan }) {
  const split = useSplitLoanByAmount();
  const groupCount = detectAmountGroups(loan);
  if (groupCount < 2) return null;
  const handleClick = async () => {
    if (!confirm(`Découper ce crédit en ${groupCount} sous-crédits selon les montants distincts détectés ?`)) return;
    try {
      const r = await split.mutateAsync(loan.id);
      alert(r.split ? `${r.createdCount} sous-crédit(s) créé(s)` : 'Aucun découpage nécessaire (un seul groupe)');
    } catch (e) {
      alert(`Erreur : ${(e as Error).message}`);
    }
  };
  return (
    <button
      onClick={handleClick}
      title={`${groupCount} montants distincts détectés`}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-warning/10 hover:bg-warning/20 text-warning text-xs font-medium border border-warning/30 mt-2"
    >
      <Split className="h-3 w-3" /> Découper en {groupCount} sous-crédits
    </button>
  );
}
