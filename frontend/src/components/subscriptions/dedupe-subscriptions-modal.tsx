import { useMemo, useState } from 'react';
import { X, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import {
  useSubscriptionDuplicates,
  useMergeSubscriptionDuplicates,
  type SubscriptionDuplicateGroup,
} from '@/lib/queries';
import { formatEUR, cn } from '@/lib/utils';

type RowStatus = 'keep' | 'merge' | 'ignore';

interface Props {
  onClose: () => void;
}

export function DedupeSubscriptionsModal({ onClose }: Props) {
  const { data: groups, isLoading, refetch } = useSubscriptionDuplicates();
  const merge = useMergeSubscriptionDuplicates();
  const [groupStatuses, setGroupStatuses] = useState<Record<string, 'idle' | 'merging' | 'merged' | 'error'>>({});

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto animate-fade-in" onClick={onClose}>
      <div className="card max-w-3xl w-full my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <h2 className="font-display font-semibold text-fg-bright">Doublons d'abonnements</h2>
            <p className="text-xs text-fg-muted">
              Heuristique : nom slugifié identique OU mot commun + montant ±5% OU partage d'un mois d'occurrence (invariant 1 retrait/mois max).
              Pour chaque ligne : <strong className="text-accent">Conserver</strong> · <strong className="text-warning">Merger</strong> · <strong className="text-fg-dim">Ignorer</strong>.
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

          {!isLoading && groups && groups.map((group, idx) => {
            const key = `${group.normalizedName}-${group.monthlyAmount}-${idx}`;
            return (
              <DedupeGroupCard
                key={key}
                group={group}
                status={groupStatuses[key] ?? 'idle'}
                onMerge={async (canonicalId, dupIds) => {
                  setGroupStatuses((s) => ({ ...s, [key]: 'merging' }));
                  try {
                    await merge.mutateAsync({ canonicalId, duplicateIds: dupIds });
                    setGroupStatuses((s) => ({ ...s, [key]: 'merged' }));
                    refetch();
                  } catch (err) {
                    setGroupStatuses((s) => ({ ...s, [key]: 'error' }));
                    alert(`Erreur : ${(err as Error).message}`);
                  }
                }}
              />
            );
          })}
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
  group: SubscriptionDuplicateGroup;
  status: 'idle' | 'merging' | 'merged' | 'error';
  onMerge: (canonicalId: string, dupIds: string[]) => void;
}) {
  // Le plus ancien est canonical par défaut (souvent le plus paramétré).
  // L'user peut basculer.
  const sortedSubs = useMemo(
    () => [...group.subscriptions].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [group.subscriptions],
  );

  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>(() => {
    const init: Record<string, RowStatus> = {};
    sortedSubs.forEach((s, i) => {
      init[s.id] = i === 0 ? 'keep' : 'merge';
    });
    return init;
  });

  const merging = status === 'merging';
  const merged = status === 'merged';

  const canonicalId = useMemo(
    () => Object.entries(rowStatus).find(([, s]) => s === 'keep')?.[0],
    [rowStatus],
  );
  const dupIds = useMemo(
    () => Object.entries(rowStatus).filter(([, s]) => s === 'merge').map(([id]) => id),
    [rowStatus],
  );

  function setStatus(subId: string, next: RowStatus) {
    setRowStatus((prev) => {
      const updated = { ...prev };
      if (next === 'keep') {
        for (const [id, s] of Object.entries(updated)) {
          if (id !== subId && s === 'keep') updated[id] = 'merge';
        }
      }
      updated[subId] = next;
      return updated;
    });
  }

  return (
    <div className={`rounded-md border p-4 ${merged ? 'border-positive/40 bg-positive/5' : 'border-border bg-surface-3'}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <h3 className="font-display font-semibold text-fg-bright">
              {group.normalizedName} <span className="text-fg-dim text-xs">~{formatEUR(group.monthlyAmount)}/mois</span>
            </h3>
          </div>
          <ul className="mt-1.5 text-xs text-fg-muted list-none space-y-0.5">
            {group.reasons.map((r, i) => <li key={i}>· {r}</li>)}
          </ul>
        </div>
      </div>

      {merged ? (
        <p className="text-sm text-positive flex items-center gap-1.5">
          <CheckCircle2 className="h-4 w-4" /> Fusion effectuée.
        </p>
      ) : (
        <>
          <ul className="space-y-2 mb-3 list-none">
            {sortedSubs.map((s) => {
              const st = rowStatus[s.id] ?? 'merge';
              return (
                <li
                  key={s.id}
                  className={cn(
                    'flex items-center gap-3 rounded-sm p-2 border transition-colors',
                    st === 'keep' && 'border-accent/40 bg-accent/5',
                    st === 'merge' && 'border-warning/30 bg-warning/5',
                    st === 'ignore' && 'border-border bg-surface opacity-70',
                  )}
                >
                  <div className="flex-1 min-w-0 text-sm">
                    <div className="font-display font-semibold text-fg-bright">{s.name}</div>
                    <div className="text-xs text-fg-muted tabular space-x-2">
                      <span>{formatEUR(s.monthlyAmount)}/mois</span>
                      <span className="font-mono">/{s.matchPattern}/</span>
                      <span>· {s.occurrencesCount} occ.</span>
                      <span className={s.isActive ? 'text-positive' : 'text-fg-dim'}>· {s.isActive ? 'actif' : 'inactif'}</span>
                    </div>
                  </div>
                  <SegmentedControl value={st} onChange={(next) => setStatus(s.id, next)} disabled={merging} />
                </li>
              );
            })}
          </ul>

          <div className="flex items-center justify-between gap-2 text-xs text-fg-muted">
            <span>Le canonical conserve l'historique d'occurrences (dédupé).</span>
            <button
              onClick={() => canonicalId && onMerge(canonicalId, dupIds)}
              disabled={merging || !canonicalId || dupIds.length === 0}
              className="btn-primary"
            >
              {merging ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Fusion…</>
              ) : (
                <>Fusionner ({dupIds.length})</>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SegmentedControl({
  value,
  onChange,
  disabled,
}: {
  value: RowStatus;
  onChange: (next: RowStatus) => void;
  disabled?: boolean;
}) {
  const options: { value: RowStatus; label: string; tone: string }[] = [
    { value: 'keep', label: 'Conserver', tone: 'text-accent' },
    { value: 'merge', label: 'Merger', tone: 'text-warning' },
    { value: 'ignore', label: 'Ignorer', tone: 'text-fg-dim' },
  ];
  return (
    <div className="inline-flex border border-border rounded overflow-hidden shrink-0">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              'px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider transition-colors',
              active ? `bg-surface-3 ${opt.tone}` : 'text-fg-dim hover:text-fg hover:bg-surface-2',
              disabled && 'opacity-50 cursor-not-allowed',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
