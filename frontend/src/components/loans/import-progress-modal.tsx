import { useEffect, useRef, useState } from 'react';
import { X, CheckCircle2, AlertCircle, Loader2, Clock } from 'lucide-react';
import { useImportCreditStatements, type CreditStatementImportResult } from '@/lib/queries';
import { formatEUR, cn } from '@/lib/utils';

type ImportRow = CreditStatementImportResult['results'][number];

interface FileState {
  file: File;
  status: 'pending' | 'running' | 'done' | 'error';
  result?: ImportRow;
  error?: string;
}

interface Props {
  files: File[];
  onClose: () => void;
}

/**
 * Popup de suivi d'un import multi-PDF crédits. Les fichiers sont envoyés
 * UN PAR UN au backend (l'endpoint accepte un batch, mais l'envoi séquentiel
 * donne l'avancement fichier par fichier — chaque analyse Claude prend
 * 10-20 s, sans feedback c'est une boîte noire). Les invalidations TanStack
 * du hook rafraîchissent la liste des crédits au fil de l'eau.
 */
export function ImportProgressModal({ files, onClose }: Props) {
  const importCredit = useImportCreditStatements();
  const [states, setStates] = useState<FileState[]>(
    files.map((file) => ({ file, status: 'pending' })),
  );
  const startedRef = useRef(false);
  // Fermer la modal annule les fichiers pas encore envoyés (celui en cours
  // d'analyse côté serveur va au bout, lui).
  const cancelledRef = useRef(false);
  useEffect(() => () => { cancelledRef.current = true; }, []);

  const doneCount = states.filter((s) => s.status === 'done' || s.status === 'error').length;
  const errorCount = states.filter(
    (s) => s.status === 'error' || (s.status === 'done' && s.result?.error),
  ).length;
  const finished = doneCount === states.length;

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      for (let i = 0; i < files.length; i++) {
        if (cancelledRef.current) break;
        setStates((prev) => prev.map((s, j) => (j === i ? { ...s, status: 'running' } : s)));
        try {
          const res = await importCredit.mutateAsync([files[i]]);
          const row = res.results[0];
          setStates((prev) =>
            prev.map((s, j) => (j === i ? { ...s, status: 'done', result: row } : s)),
          );
        } catch (e) {
          setStates((prev) =>
            prev.map((s, j) =>
              j === i ? { ...s, status: 'error', error: (e as Error).message } : s,
            ),
          );
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto animate-fade-in"
      onClick={finished ? onClose : undefined}
    >
      <div className="card max-w-2xl w-full my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <h2 className="font-display font-semibold text-fg-bright">
              {finished ? 'Import terminé' : 'Import en cours…'}
            </h2>
            <p className="text-xs text-fg-muted">
              {doneCount}/{states.length} fichier{states.length > 1 ? 's' : ''} traité
              {doneCount > 1 ? 's' : ''}
              {errorCount > 0 && (
                <span className="text-negative"> · {errorCount} problème{errorCount > 1 ? 's' : ''}</span>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className={cn('btn-ghost p-1', !finished && 'opacity-40')}
            title={finished ? 'Fermer' : "L'import continue côté serveur pour le fichier en cours — les suivants seront annulés."}
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-2">
          <div className="h-1.5 rounded-full bg-border overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                errorCount > 0 ? 'bg-warning' : 'bg-positive',
              )}
              style={{ width: `${(doneCount / states.length) * 100}%` }}
            />
          </div>
        </div>

        <ul className="p-5 pt-3 space-y-2">
          {states.map((s, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              {s.status === 'pending' && <Clock className="h-4 w-4 text-fg-dim mt-0.5 shrink-0" />}
              {s.status === 'running' && (
                <Loader2 className="h-4 w-4 text-accent animate-spin mt-0.5 shrink-0" />
              )}
              {s.status === 'done' && !s.result?.error && (
                <CheckCircle2 className="h-4 w-4 text-positive mt-0.5 shrink-0" />
              )}
              {(s.status === 'error' || (s.status === 'done' && s.result?.error)) && (
                <AlertCircle className="h-4 w-4 text-negative mt-0.5 shrink-0" />
              )}
              <span className="flex-1 min-w-0">
                <span className="font-mono text-xs text-fg-dim break-all">{s.file.name}</span>
                {s.status === 'pending' && (
                  <span className="block text-fg-dim text-xs">En attente</span>
                )}
                {s.status === 'running' && (
                  <span className="block text-accent text-xs">Analyse du PDF en cours (Claude)…</span>
                )}
                {s.status === 'error' && (
                  <span className="block text-negative text-xs">{s.error}</span>
                )}
                {s.status === 'done' && s.result?.error && (
                  <span className="block text-negative text-xs">{s.result.error}</span>
                )}
                {s.status === 'done' && s.result && !s.result.error && (
                  <span className="block text-fg-muted text-xs">
                    {s.result.kind === 'amortization' && <>📊 plan d'amortissement · </>}
                    {s.result.created ? '🆕 nouveau crédit' : '🔗 rattaché'} · {s.result.creditor}
                    {s.result.accountNumber && <> · #{s.result.accountNumber}</>}
                    {s.result.monthlyPayment != null && (
                      <> · {formatEUR(s.result.monthlyPayment)}/mois</>
                    )}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>

        {finished && (
          <div className="border-t border-border px-5 py-3 flex justify-end">
            <button onClick={onClose} className="btn-secondary">Fermer</button>
          </div>
        )}
      </div>
    </div>
  );
}
