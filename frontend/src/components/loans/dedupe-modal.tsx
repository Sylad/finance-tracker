import { useState } from 'react';
import { X, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import {
  useLoanDuplicates,
  useMergeLoanDuplicates,
  type LoanDuplicateGroup,
} from '@/lib/queries';
import { formatEUR } from '@/lib/utils';

interface Props {
  onClose: () => void;
}

export function DedupeModal({ onClose }: Props) {
  const { data: groups, isLoading, refetch } = useLoanDuplicates();
  const merge = useMergeLoanDuplicates();
  const [statuses, setStatuses] = useState<Record<string, 'idle' | 'merging' | 'merged' | 'error'>>({});

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto animate-fade-in" onClick={onClose}>
      <div className="card max-w-3xl w-full my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <h2 className="font-display font-semibold text-fg-bright">Détecter et fusionner les doublons</h2>
            <p className="text-xs text-fg-muted">
              Heuristique : même créancier + même type + mensualité ±5%. À toi de valider chaque groupe — pas d'auto-merge.
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost p-1" aria-label="Fermer"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          {isLoading && <p className="text-sm text-fg-muted py-8 text-center">Analyse en cours…</p>}

          {!isLoading && groups && groups.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-positive py-6 justify-center">
              <CheckCircle2 className="h-5 w-5" />
              <span>Aucun doublon détecté.</span>
            </div>
          )}

          {!isLoading && groups && groups.map((group, idx) => (
            <DedupeGroupCard
              key={`${group.creditor}-${idx}`}
              group={group}
              status={statuses[idx] ?? 'idle'}
              onMerge={async (canonicalId, dupIds) => {
                setStatuses((s) => ({ ...s, [idx]: 'merging' }));
                try {
                  await merge.mutateAsync({ canonicalId, duplicateIds: dupIds });
                  setStatuses((s) => ({ ...s, [idx]: 'merged' }));
                  refetch();
                } catch (err) {
                  setStatuses((s) => ({ ...s, [idx]: 'error' }));
                  alert(`Erreur : ${(err as Error).message}`);
                }
              }}
            />
          ))}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button onClick={onClose} className="btn-secondary">Fermer</button>
        </div>
      </div>
    </div>
  );
}

function DedupeGroupCard({
  group,
  status,
  onMerge,
}: {
  group: LoanDuplicateGroup;
  status: 'idle' | 'merging' | 'merged' | 'error';
  onMerge: (canonicalId: string, dupIds: string[]) => void;
}) {
  const [canonicalId, setCanonicalId] = useState<string>(group.loans[0]?.id ?? '');
  const [selectedDups, setSelectedDups] = useState<Set<string>>(
    new Set(group.loans.slice(1).map((l) => l.id)),
  );

  const merging = status === 'merging';
  const merged = status === 'merged';

  return (
    <div className={`rounded-md border p-4 ${merged ? 'border-positive/40 bg-positive/5' : 'border-border bg-surface-3'}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <h3 className="font-display font-semibold text-fg-bright">
              {group.creditor} <span className="text-fg-dim text-xs uppercase">({group.type})</span>
            </h3>
          </div>
          <ul className="mt-1.5 text-xs text-fg-muted list-none space-y-0.5">
            {group.reasons.map((r, i) => <li key={i}>· {r}</li>)}
          </ul>
        </div>
      </div>

      {merged ? (
        <p className="text-sm text-positive flex items-center gap-1.5">
          <CheckCircle2 className="h-4 w-4" /> Fusion effectuée. Recharge pour la prochaine analyse.
        </p>
      ) : (
        <>
          <div className="space-y-2 mb-3">
            {group.loans.map((l) => {
              const isCanonical = l.id === canonicalId;
              const isSelectedAsDup = selectedDups.has(l.id);
              return (
                <div
                  key={l.id}
                  className={`flex items-start gap-3 rounded-sm p-2 border ${
                    isCanonical
                      ? 'border-accent/40 bg-accent/5'
                      : isSelectedAsDup
                      ? 'border-warning/30 bg-warning/5'
                      : 'border-border bg-surface'
                  }`}
                >
                  <input
                    type="radio"
                    name={`canonical-${group.creditor}`}
                    checked={isCanonical}
                    disabled={merging}
                    onChange={() => {
                      setCanonicalId(l.id);
                      setSelectedDups((prev) => {
                        const next = new Set(prev);
                        next.delete(l.id);
                        return next;
                      });
                    }}
                    className="mt-1"
                    aria-label="Conserver comme canonical"
                  />
                  <input
                    type="checkbox"
                    checked={isSelectedAsDup}
                    disabled={merging || isCanonical}
                    onChange={(e) => {
                      setSelectedDups((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(l.id);
                        else next.delete(l.id);
                        return next;
                      });
                    }}
                    className="mt-1"
                    aria-label="Marquer comme doublon à fusionner"
                  />
                  <div className="flex-1 min-w-0 text-sm">
                    <div className="font-display font-semibold text-fg-bright">{l.name}</div>
                    <div className="text-xs text-fg-muted tabular space-x-2">
                      <span>{formatEUR(l.monthlyPayment)}/mois</span>
                      {l.contractRef && <span className="font-mono">#{l.contractRef}</span>}
                      {l.maxAmount != null && <span>plafond {formatEUR(l.maxAmount)}</span>}
                      <span>· {l.occurrencesCount} occurrence{l.occurrencesCount > 1 ? 's' : ''}</span>
                      <span className={l.isActive ? 'text-positive' : 'text-fg-dim'}>
                        · {l.isActive ? 'actif' : 'archivé'}
                      </span>
                    </div>
                    {l.rumRefs && l.rumRefs.length > 0 && (
                      <div className="text-[11px] text-fg-muted font-mono mt-0.5 break-all">
                        RUM: {l.rumRefs.join(' · ')}
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] uppercase tracking-wider font-semibold shrink-0">
                    {isCanonical ? <span className="text-accent">À conserver</span> : isSelectedAsDup ? <span className="text-warning">À merger</span> : <span className="text-fg-dim">—</span>}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-2 text-xs text-fg-muted">
            <span>
              Le canonical conservera l'historique d'occurrences (dédupé) + l'union des RUMs + le contractRef si manquant.
            </span>
            <button
              onClick={() => onMerge(canonicalId, [...selectedDups])}
              disabled={merging || selectedDups.size === 0}
              className="btn-primary"
            >
              {merging ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Fusion…</>
              ) : (
                <>Fusionner ({selectedDups.size})</>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
