import { useEffect, useMemo, useState } from 'react';
import { Loader2, X, Sparkles, CheckCircle2, AlertTriangle, AlertCircle } from 'lucide-react';
import {
  useAutoCategorizePreview,
  useAutoCategorizeApply,
  type AutoCategorizeSuggestion,
  type AutoCategorizeDecision,
} from '@/lib/queries';
import { CATEGORY_LABELS, type TransactionCategory } from '@/types/api';
import { formatEUR, formatDate, cn } from '@/lib/utils';

interface Props {
  statementId: string;
  onClose: () => void;
}

interface Row {
  s: AutoCategorizeSuggestion;
  apply: boolean;
  createRule: boolean;
  rulePattern: string;
  replayAll: boolean;
  category: string; // editable target category
}

const MIN_CONFIDENCE_FOR_AUTO_APPLY = 0.6;

function categoryLabel(cat: string): string {
  if ((CATEGORY_LABELS as Record<string, string>)[cat]) {
    return CATEGORY_LABELS[cat as TransactionCategory];
  }
  return cat; // user-defined category
}

function confidenceTone(c: number): { color: string; label: string } {
  if (c >= 0.8) return { color: 'text-positive', label: 'Sûr' };
  if (c >= 0.6) return { color: 'text-info', label: 'Plausible' };
  return { color: 'text-warning', label: 'Doute' };
}

export function AutoCategorizeModal({ statementId, onClose }: Props) {
  const previewMut = useAutoCategorizePreview();
  const applyMut = useAutoCategorizeApply();

  const [rows, setRows] = useState<Row[]>([]);
  const [hasPreviewed, setHasPreviewed] = useState(false);

  // Lock the body scroll behind the modal + ESC closes.
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  const launchPreview = async () => {
    try {
      const res = await previewMut.mutateAsync(statementId);
      setHasPreviewed(true);
      setRows(
        res.suggestions.map((s) => ({
          s,
          apply: s.confidence >= MIN_CONFIDENCE_FOR_AUTO_APPLY,
          createRule: !!s.proposedRulePattern && s.confidence >= 0.75,
          rulePattern: s.proposedRulePattern ?? '',
          replayAll: false,
          category: s.suggestedCategory,
        })),
      );
    } catch {
      // error rendered below from mutation state
    }
  };

  const toggle = (idx: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const decisions: AutoCategorizeDecision[] = useMemo(
    () =>
      rows
        .filter((r) => r.apply)
        .map((r) => ({
          transactionId: r.s.transactionId,
          category: r.category,
          rulePattern: r.createRule && r.rulePattern.trim() ? r.rulePattern.trim() : undefined,
          replayAll: r.createRule && r.replayAll,
        })),
    [rows],
  );

  const launchApply = async () => {
    if (decisions.length === 0) return;
    await applyMut.mutateAsync({ statementId, decisions }).then(() => onClose()).catch(() => {});
  };

  const previewData = previewMut.data;
  const totalApplyCount = decisions.length;
  const totalRuleCount = decisions.filter((d) => d.rulePattern).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="card w-full max-w-3xl max-h-[90vh] flex flex-col p-0 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent-bright" />
              <h2 className="font-display font-semibold text-fg-bright">Auto-catégoriser via Claude</h2>
            </div>
            <p className="text-xs text-fg-muted mt-1">
              Demande à Claude de proposer une catégorie pour chaque transaction "Autre" du relevé.
            </p>
          </div>
          <button onClick={onClose} className="text-fg-muted hover:text-fg" title="Fermer">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-auto px-6 py-5">
          {!hasPreviewed && !previewMut.isPending && (
            <PreviewCta onLaunch={launchPreview} />
          )}

          {previewMut.isPending && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-accent-bright" />
              <p className="text-sm text-fg-muted">Claude examine les transactions… (~10-20 s)</p>
              <p className="text-xs text-fg-dim">Coût estimé : quelques centimes.</p>
            </div>
          )}

          {previewMut.isError && (
            <ErrorBanner error={previewMut.error as Error | null} />
          )}

          {hasPreviewed && previewData && (
            <>
              <div className="text-xs text-fg-muted mb-4 flex flex-wrap items-center gap-3">
                <span>
                  <span className="text-fg-bright font-semibold">{previewData.totalOther}</span> transactions "Autre"
                  · <span className="text-fg-bright font-semibold">{previewData.suggestions.length}</span> suggestion
                  {previewData.suggestions.length > 1 ? 's' : ''} de Claude
                </span>
                {previewData.warnings.length > 0 && (
                  <span className="badge-info text-[10px] cursor-help" title={previewData.warnings.join('\n')}>
                    {previewData.warnings.length} avertissement{previewData.warnings.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>

              {previewData.suggestions.length === 0 ? (
                <EmptyState totalOther={previewData.totalOther} />
              ) : (
                <div className="space-y-2">
                  {rows.map((r, i) => (
                    <SuggestionRow
                      key={r.s.transactionId}
                      row={r}
                      availableCategories={previewData.availableCategories}
                      onChange={(patch) => toggle(i, patch)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {hasPreviewed && previewData && previewData.suggestions.length > 0 && (
          <footer className="border-t border-border px-6 py-4 flex flex-wrap items-center justify-between gap-3 shrink-0">
            <div className="text-xs text-fg-muted">
              {totalApplyCount > 0 ? (
                <>
                  Appliquer <span className="text-fg-bright font-semibold">{totalApplyCount}</span> changement
                  {totalApplyCount > 1 ? 's' : ''}
                  {totalRuleCount > 0 && (
                    <>
                      {' '}+ créer <span className="text-fg-bright font-semibold">{totalRuleCount}</span> règle{totalRuleCount > 1 ? 's' : ''}
                    </>
                  )}
                </>
              ) : (
                'Aucune suggestion sélectionnée'
              )}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={onClose} className="btn-ghost text-sm">Annuler</button>
              <button
                onClick={launchApply}
                disabled={applyMut.isPending || totalApplyCount === 0}
                className="btn-primary text-sm"
              >
                {applyMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Appliquer
              </button>
            </div>
          </footer>
        )}

        {applyMut.isError && (
          <div className="px-6 pb-4">
            <ErrorBanner error={applyMut.error as Error | null} />
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewCta({ onLaunch }: { onLaunch: () => void }) {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-12">
      <div className="h-12 w-12 rounded-full bg-accent/15 border border-accent/40 flex items-center justify-center">
        <Sparkles className="h-5 w-5 text-accent-bright" />
      </div>
      <p className="text-sm text-fg-bright max-w-md">
        Claude va analyser chaque transaction "Autre" et te proposer une catégorie + une règle réutilisable.
        Tu garderas le dernier mot avant d'appliquer quoi que ce soit.
      </p>
      <p className="text-[11px] text-fg-dim max-w-md">
        Coût Anthropic : ~0,01-0,05 € par relevé. Désactivé en mode démo.
      </p>
      <button onClick={onLaunch} className="btn-primary text-sm mt-2">
        <Sparkles className="h-4 w-4" /> Lancer l'analyse Claude
      </button>
    </div>
  );
}

function EmptyState({ totalOther }: { totalOther: number }) {
  return (
    <div className="flex flex-col items-center text-center gap-2 py-12">
      <CheckCircle2 className="h-8 w-8 text-positive" />
      <p className="text-sm text-fg-bright">
        {totalOther === 0
          ? 'Toutes les transactions ont déjà une catégorie autre que "Autre".'
          : 'Claude n\'a pas trouvé de meilleure catégorie pour les transactions restantes.'}
      </p>
    </div>
  );
}

function ErrorBanner({ error }: { error: Error | null }) {
  return (
    <div className="flex items-start gap-2 p-3 rounded-md bg-negative/10 border border-negative/40 text-sm">
      <AlertCircle className="h-4 w-4 text-negative shrink-0 mt-0.5" />
      <div>
        <div className="font-medium text-negative">Échec</div>
        <div className="text-xs text-fg-muted mt-0.5">{error?.message ?? 'Erreur inconnue'}</div>
      </div>
    </div>
  );
}

function SuggestionRow({
  row,
  availableCategories,
  onChange,
}: {
  row: Row;
  availableCategories: string[];
  onChange: (patch: Partial<Row>) => void;
}) {
  const tone = confidenceTone(row.s.confidence);
  return (
    <div className={cn('rounded-md border px-3 py-2.5 transition-colors', row.apply ? 'bg-surface-2 border-accent/30' : 'bg-surface border-border')}>
      <div className="grid grid-cols-12 gap-3 items-start">
        <label className="col-span-1 mt-0.5 cursor-pointer">
          <input
            type="checkbox"
            checked={row.apply}
            onChange={(e) => onChange({ apply: e.target.checked })}
          />
        </label>
        <div className="col-span-7 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-sm font-medium text-fg truncate">{row.s.description}</span>
            <span className={cn('text-[10px] uppercase tracking-wider font-semibold', tone.color)}>
              {tone.label} ({Math.round(row.s.confidence * 100)}%)
            </span>
          </div>
          <div className="text-[11px] text-fg-dim mt-0.5">
            {formatDate(row.s.date)} · <span className="tabular">{formatEUR(row.s.amount)}</span>
          </div>
          <div className="text-xs text-fg-muted mt-1 italic line-clamp-2">{row.s.reasoning}</div>
        </div>
        <div className="col-span-4 space-y-2">
          <select
            value={row.category}
            onChange={(e) => onChange({ category: e.target.value })}
            className="input text-xs py-1 w-full"
          >
            {availableCategories.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(c)}
              </option>
            ))}
          </select>
          {row.s.proposedRulePattern && (
            <label className="flex items-start gap-1.5 cursor-pointer text-[11px] text-fg-muted">
              <input
                type="checkbox"
                checked={row.createRule}
                onChange={(e) => onChange({ createRule: e.target.checked })}
                className="mt-0.5"
              />
              <span>
                Créer la règle{' '}
                <code className="text-[10px] bg-surface-3 px-1 py-0.5 rounded text-fg">
                  {row.rulePattern || row.s.proposedRulePattern}
                </code>
              </span>
            </label>
          )}
          {row.createRule && (
            <label className="flex items-start gap-1.5 cursor-pointer text-[11px] text-fg-muted ml-4">
              <input
                type="checkbox"
                checked={row.replayAll}
                onChange={(e) => onChange({ replayAll: e.target.checked })}
                className="mt-0.5"
              />
              <span className="flex items-center gap-1">
                Rejouer sur l'historique
                <AlertTriangle className="h-3 w-3 text-warning" />
              </span>
            </label>
          )}
        </div>
      </div>
    </div>
  );
}
