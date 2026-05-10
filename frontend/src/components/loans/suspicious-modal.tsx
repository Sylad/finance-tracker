import { useState } from 'react';
import { X, AlertTriangle, CheckCircle2, Loader2, Trash2, ShoppingBag } from 'lucide-react';
import {
  useSuspiciousLoans,
  useCleanupSuspiciousLoans,
  useConvertToInstallment,
} from '@/lib/queries';
import { formatEUR } from '@/lib/utils';

interface Props {
  onClose: () => void;
}

export function SuspiciousModal({ onClose }: Props) {
  const { data: items, isLoading, refetch } = useSuspiciousLoans();
  const cleanup = useCleanupSuspiciousLoans();
  const convert = useConvertToInstallment();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cleaning, setCleaning] = useState(false);
  const [convertingId, setConvertingId] = useState<string | null>(null);

  const handleConvert = async (id: string, name: string) => {
    if (!confirm(`Convertir « ${name} » en paiement échelonné ?\n\nLes occurrences détectées deviendront un échéancier complet (toutes marquées payées). Le crédit sera désactivé si toutes les échéances sont passées.`)) {
      return;
    }
    setConvertingId(id);
    try {
      await convert.mutateAsync(id);
      refetch();
    } catch (e) {
      alert(`Erreur conversion : ${(e as Error).message}`);
    }
    setConvertingId(null);
  };

  const toggleAll = () => {
    if (!items) return;
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((i) => i.id)));
  };

  const handleCleanup = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Supprimer ${selected.size} crédit(s) suspect(s) ? Cette action est irréversible.`)) {
      return;
    }
    setCleaning(true);
    try {
      const result = await cleanup.mutateAsync([...selected]);
      alert(`${result.deletedCount} crédit(s) supprimé(s).`);
      setSelected(new Set());
      refetch();
    } catch (e) {
      alert(`Erreur : ${(e as Error).message}`);
    }
    setCleaning(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto animate-fade-in" onClick={onClose}>
      <div className="card max-w-3xl w-full my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <h2 className="font-display font-semibold text-fg-bright flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              Crédits suspects
            </h2>
            <p className="text-xs text-fg-muted">
              Heuristiques : nom matche pay-in-N (4X CB, FacilyPay…) OU ≤4 occurrences sur ≤4 mois et arrêté depuis ≥60j.
              Vérifie chaque ligne — supprime ou convertis en paiement échelonné (échéancier reconstruit).
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost p-1" aria-label="Fermer"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5">
          {isLoading && <p className="text-sm text-fg-muted py-8 text-center">Analyse en cours…</p>}

          {!isLoading && items && items.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-positive py-6 justify-center">
              <CheckCircle2 className="h-5 w-5" />
              <span>Aucun crédit suspect détecté.</span>
            </div>
          )}

          {!isLoading && items && items.length > 0 && (
            <>
              <div className="flex items-center justify-between mb-3 text-xs">
                <button onClick={toggleAll} className="btn-ghost">
                  {selected.size === items.length ? 'Tout décocher' : 'Tout cocher'}
                </button>
                <span className="text-fg-muted">{selected.size} / {items.length} sélectionné(s)</span>
              </div>

              <ul className="space-y-2 list-none">
                {items.map((l) => {
                  const isSel = selected.has(l.id);
                  return (
                    <li
                      key={l.id}
                      className={`flex items-start gap-3 rounded-sm p-2 border transition-colors ${
                        isSel ? 'border-warning/40 bg-warning/5' : 'border-border bg-surface-3'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSel}
                        disabled={cleaning}
                        onChange={(e) => {
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(l.id);
                            else next.delete(l.id);
                            return next;
                          });
                        }}
                        className="mt-1"
                        aria-label={`Sélectionner ${l.name}`}
                      />
                      <div className="flex-1 min-w-0 text-sm">
                        <div className="font-display font-semibold text-fg-bright">{l.name}</div>
                        <div className="text-xs text-fg-muted tabular space-x-2">
                          {l.creditor && <span>{l.creditor}</span>}
                          <span>{formatEUR(l.monthlyPayment)}/mois</span>
                          <span>· {l.occurrencesCount} occurrence{l.occurrencesCount > 1 ? 's' : ''}</span>
                          {l.lastOccurrenceDate && (
                            <span className="text-fg-dim">· dernière {l.lastOccurrenceDate}</span>
                          )}
                        </div>
                        <div className="text-[11px] text-warning mt-1 italic">{l.reason}</div>
                      </div>
                      <button
                        onClick={() => handleConvert(l.id, l.name)}
                        disabled={cleaning || convertingId !== null}
                        className="btn-ghost text-xs shrink-0"
                        title="Convertit en paiement échelonné (kind='installment') avec un échéancier reconstruit depuis les occurrences détectées."
                      >
                        {convertingId === l.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <><ShoppingBag className="h-3.5 w-3.5" /> En N×</>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>

              <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-border">
                <button onClick={onClose} className="btn-secondary">Annuler</button>
                <button
                  onClick={handleCleanup}
                  disabled={selected.size === 0 || cleaning}
                  className="btn-primary"
                >
                  {cleaning ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Suppression…</>
                  ) : (
                    <><Trash2 className="h-3.5 w-3.5" /> Supprimer ({selected.size})</>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
