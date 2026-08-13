import { useRef, useState } from 'react';
import { Plus, Upload, Loader2, AlertCircle, X, GitMerge, AlertTriangle, RotateCcw, Sparkles, ChevronDown, ChevronRight } from 'lucide-react';
import {
  useLoans,
  useCreateLoan,
  useUpdateLoan,
  useDeleteLoan,
  useAcceptSuggestion,
  useResetLoans,
  useDetectionScan,
  type ResetLoansResult,
} from '@/lib/queries';
import { ApiError } from '@/lib/api';
import { PageHeader } from '@/components/page-header';
import { LoadingState, EmptyState } from '@/components/loading-state';
import { type Loan, type LoanInput, type DetectionScanResult } from '@/types/api';
import { formatEUR } from '@/lib/utils';
import { ClassicCard } from '@/components/loans/classic-card';
import { RevolvingCard } from '@/components/loans/revolving-card';
import { ClosedCard } from '@/components/loans/closed-card';
import { InstallmentCard } from '@/components/loans/installment-card';
import { LoanForm } from '@/components/loans/loan-form';
import { SuggestionsBanner } from '@/components/loans/suggestions-banner';
import { LoansMonthlyChart } from '@/components/loans/loans-monthly-chart';
import { DedupeModal } from '@/components/loans/dedupe-modal';
import { ImportProgressModal } from '@/components/loans/import-progress-modal';
import { SuspiciousModal } from '@/components/loans/suspicious-modal';
import { toLoanInput } from '@/components/loans/utils';

const DEFAULT: LoanInput = {
  name: '',
  type: 'classic',
  category: 'consumer',
  monthlyPayment: 0,
  matchPattern: '',
  isActive: true,
  creditor: '',
  contractRef: '',
  startDate: '',
  endDate: '',
};

export function LoansPage() {
  const { data, isLoading } = useLoans();
  const create = useCreateLoan();
  const update = useUpdateLoan();
  const remove = useDeleteLoan();
  const acceptSugg = useAcceptSuggestion();
  const resetLoans = useResetLoans();
  const detectionScan = useDetectionScan();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<Loan | null>(null);
  const [creating, setCreating] = useState(false);
  const [suggestionToAccept, setSuggestionToAccept] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState<LoanInput | null>(null);
  const [importFiles, setImportFiles] = useState<File[] | null>(null);
  const [dedupeOpen, setDedupeOpen] = useState(false);
  const [suspiciousOpen, setSuspiciousOpen] = useState(false);
  const [resetResult, setResetResult] = useState<ResetLoansResult | null>(null);
  const [scanResult, setScanResult] = useState<DetectionScanResult | null>(null);
  const [scanErrorsOpen, setScanErrorsOpen] = useState(false);
  const [scanOllamaDown, setScanOllamaDown] = useState<string | null>(null);

  const handleScan = async () => {
    setScanOllamaDown(null);
    setScanErrorsOpen(false);
    try {
      const result = await detectionScan.mutateAsync();
      setScanResult(result);
    } catch (e) {
      if (e instanceof ApiError && e.status === 502) {
        setScanResult(null);
        setScanOllamaDown(e.message);
      } else {
        alert(`Erreur scan détection : ${(e as Error).message}`);
      }
    }
  };

  const handleReset = async () => {
    if (!confirm(
      'Reset des crédits ?\n\n'
      + 'Cette action :\n'
      + '  • Supprime TOUS les crédits actuels\n'
      + '  • Reset toutes les suggestions à pending\n'
      + '  • Replay l\'auto-sync sur les relevés existants avec le nouvel invariant "1 débit/mois max par crédit"\n\n'
      + 'Les relevés bancaires et de crédit ne sont PAS touchés. La détection repart de zéro avec une logique propre.\n\n'
      + 'Continuer ?'
    )) return;
    try {
      const result = await resetLoans.mutateAsync();
      setResetResult(result);
    } catch (e) {
      alert(`Erreur reset : ${(e as Error).message}`);
    }
  };

  const handleCreditUpload = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setImportFiles(Array.from(files));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  if (isLoading) return <LoadingState />;
  const items = data ?? [];
  const kindOf = (l: Loan) => l.kind ?? l.type;
  const installments = items.filter((l) => kindOf(l) === 'installment' && l.isActive);
  const classics = items.filter((l) => kindOf(l) === 'classic' && l.isActive);
  const revolvings = items.filter((l) => kindOf(l) === 'revolving' && l.isActive);
  const closed = items.filter((l) => !l.isActive);
  const totalMonthly = items.filter((l) => l.isActive).reduce((s, l) => s + l.monthlyPayment, 0);

  const handleSave = async (input: LoanInput) => {
    try {
      let saved: Loan;
      if (editing) saved = await update.mutateAsync({ id: editing.id, input });
      else saved = await create.mutateAsync(input);
      if (suggestionToAccept) {
        try {
          await acceptSugg.mutateAsync({ id: suggestionToAccept, loanId: saved.id });
        } catch (e) {
          console.error('Accept suggestion failed', e);
        }
        setSuggestionToAccept(null);
      }
      setEditing(null);
      setCreating(false);
      setPrefilled(null);
    } catch (e) {
      alert(`Erreur lors de l'enregistrement : ${(e as Error).message}`);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Crédits"
        title={`${formatEUR(totalMonthly)} / mois`}
        subtitle={`${items.filter((l) => l.isActive).length} crédit${items.length > 1 ? 's' : ''} actif${items.length > 1 ? 's' : ''}`}
        actions={
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              multiple
              hidden
              onChange={(e) => handleCreditUpload(e.target.files)}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importFiles != null}
              className="btn-secondary"
              title="Importer un ou plusieurs PDF : relevés de crédit ET plans d'amortissement, mélangés. Chaque PDF est reconnu (type + N° de contrat) et rattaché automatiquement au bon crédit."
            >
              <Upload className="h-4 w-4" /> Importer PDF crédits
            </button>
            <button
              onClick={handleScan}
              disabled={detectionScan.isPending}
              className="btn-secondary"
              title="Analyse les clusters de transactions non-rattachées via un LLM local (Ollama) pour détecter des paiements en plusieurs fois. Peut durer 1-3 min."
            >
              {detectionScan.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Analyse en cours sur la 5090…</>
              ) : (
                <><Sparkles className="h-4 w-4" /> Détecter les crédits (IA locale)</>
              )}
            </button>
            <button
              onClick={() => setDedupeOpen(true)}
              className="btn-secondary"
              title="Détecter et fusionner les doublons (créés avant le matching RUM)"
            >
              <GitMerge className="h-4 w-4" /> Doublons
            </button>
            <button
              onClick={() => setSuspiciousOpen(true)}
              className="btn-secondary"
              title="Détecter les crédits suspects (paiements en 4 fois créés à tort + loans absents du dernier relevé — invariant 1 débit/mois)"
            >
              <AlertTriangle className="h-4 w-4" /> Suspects
            </button>
            <button
              onClick={handleReset}
              disabled={resetLoans.isPending}
              className="btn-secondary text-negative hover:bg-negative/10 hover:text-negative border-negative/30"
              title="Purge tous les crédits + reset suggestions à pending + replay auto-sync sur relevés existants avec invariant 1 débit/mois max"
            >
              {resetLoans.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Reset…</>
              ) : (
                <><RotateCcw className="h-4 w-4" /> Reset</>
              )}
            </button>
            <button onClick={() => { setCreating(true); setEditing(null); }} className="btn-primary">
              <Plus className="h-4 w-4" /> Nouveau crédit
            </button>
          </div>
        }
      />

      {dedupeOpen && <DedupeModal onClose={() => setDedupeOpen(false)} />}
      {suspiciousOpen && <SuspiciousModal onClose={() => setSuspiciousOpen(false)} />}

      {resetResult && (
        <div className="card p-5 mb-4 relative border-warning/40">
          <button
            onClick={() => setResetResult(null)}
            className="absolute top-3 right-3 text-fg-dim hover:text-fg"
            aria-label="Fermer"
          ><X className="h-4 w-4" /></button>
          <h3 className="font-display text-sm font-semibold text-fg-bright mb-2 flex items-center gap-2">
            <RotateCcw className="h-4 w-4 text-warning" />
            Reset crédits effectué
          </h3>
          <p className="text-sm text-fg-muted">
            {resetResult.deletedLoans} crédit{resetResult.deletedLoans > 1 ? 's supprimés' : ' supprimé'},
            {' '}{resetResult.resetSuggestions} suggestion{resetResult.resetSuggestions > 1 ? 's reset à pending' : ' reset à pending'},
            {' '}{resetResult.replayedStatements} relevé{resetResult.replayedStatements > 1 ? 's' : ''} replayés.
            {' '}<span className="font-display text-fg-bright">{resetResult.finalLoans} crédit{resetResult.finalLoans > 1 ? 's' : ''}</span> recréé{resetResult.finalLoans > 1 ? 's' : ''} avec l'invariant "1 débit/mois max".
          </p>
        </div>
      )}

      {scanOllamaDown && (
        <div className="card p-5 mb-4 relative border-negative/40">
          <button
            onClick={() => setScanOllamaDown(null)}
            className="absolute top-3 right-3 text-fg-dim hover:text-fg"
            aria-label="Fermer"
          ><X className="h-4 w-4" /></button>
          <h3 className="font-display text-sm font-semibold text-negative mb-2 flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            Ollama éteint ?
          </h3>
          <p className="text-sm text-fg-muted">
            Le scan IA locale n'a pas pu joindre Ollama (RTX 5090). Vérifie que le service tourne, puis réessaie.
          </p>
          <p className="text-xs text-fg-dim font-mono mt-1">{scanOllamaDown}</p>
        </div>
      )}

      {scanResult && (
        <div className={`card p-5 mb-4 relative ${scanResult.errors.length > 0 ? 'border-warning/40' : ''}`}>
          <button
            onClick={() => setScanResult(null)}
            className="absolute top-3 right-3 text-fg-dim hover:text-fg"
            aria-label="Fermer"
          ><X className="h-4 w-4" /></button>
          <h3 className="font-display text-sm font-semibold text-fg-bright mb-2 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" />
            Scan IA locale terminé
          </h3>
          <p className="text-sm text-fg-muted">
            <span className="font-display text-fg-bright">{scanResult.clustersAnalyzed}</span> cluster{scanResult.clustersAnalyzed > 1 ? 's' : ''} analysé{scanResult.clustersAnalyzed > 1 ? 's' : ''},
            {' '}<span className="font-display text-fg-bright">{scanResult.suggestionsCreated}</span> suggestion{scanResult.suggestionsCreated > 1 ? 's créées' : ' créée'},
            {' '}<span className={scanResult.errors.length > 0 ? 'font-display text-warning' : 'font-display text-fg-bright'}>{scanResult.errors.length}</span> erreur{scanResult.errors.length > 1 ? 's' : ''}.
          </p>
          {scanResult.errors.length > 0 && (
            <div className="mt-2">
              <button
                onClick={() => setScanErrorsOpen((o) => !o)}
                className="inline-flex items-center gap-1 text-xs font-medium text-warning hover:text-warning/80"
              >
                {scanErrorsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {scanErrorsOpen ? 'Masquer' : 'Voir'} les erreurs ({scanResult.errors.length})
              </button>
              {scanErrorsOpen && (
                <ul className="mt-2 space-y-1">
                  {scanResult.errors.map((err, i) => (
                    <li key={i} className="text-xs text-fg-muted">
                      <span className="font-mono text-fg-dim">{err.clusterKey}</span> — {err.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {importFiles && (
        <ImportProgressModal files={importFiles} onClose={() => setImportFiles(null)} />
      )}

      {items.length > 0 && <LoansMonthlyChart loans={items} />}

      {items.length === 0 ? (
        <EmptyState title="Aucun crédit déclaré" hint="Ajoute ton crédit immobilier, conso ou ta carte revolving." />
      ) : (
        <div className="space-y-8 mb-6">
          {installments.length > 0 && (
            <section>
              <h2 className="font-display text-sm uppercase tracking-wider text-fg-dim mb-3">
                Paiements échelonnés actifs ({installments.length})
              </h2>
              <p className="text-xs text-fg-dim mb-3">
                Crédits courts en N fois (4XCB Cofidis, Alma 4X, Klarna 3X, FacilyPay…) avec échéancier précis.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {installments.map((l) => (
                  <InstallmentCard
                    key={l.id}
                    loan={l}
                    onEdit={() => setEditing(l)}
                    onDelete={() => confirm(`Supprimer ${l.name} ?`) && remove.mutate(l.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {classics.length > 0 && (
            <section>
              <h2 className="font-display text-sm uppercase tracking-wider text-fg-dim mb-3">
                Crédits classiques ({classics.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {classics.map((l) => (
                  <ClassicCard key={l.id} loan={l} onEdit={() => setEditing(l)} onDelete={() => confirm(`Supprimer ${l.name} ?`) && remove.mutate(l.id)} />
                ))}
              </div>
            </section>
          )}

          {revolvings.length > 0 && (
            <section>
              <h2 className="font-display text-sm uppercase tracking-wider text-fg-dim mb-3">
                Crédits revolving ({revolvings.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {revolvings.map((l) => (
                  <RevolvingCard key={l.id} loan={l} onEdit={() => setEditing(l)} onDelete={() => confirm(`Supprimer ${l.name} ?`) && remove.mutate(l.id)} />
                ))}
              </div>
            </section>
          )}

          {closed.length > 0 && (
            <section>
              <h2 className="font-display text-sm uppercase tracking-wider text-negative mb-3 flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-negative" />
                Crédits terminés ({closed.length})
              </h2>
              <p className="text-xs text-fg-dim mb-3">Ces crédits n'ont plus eu de mensualité dans les 2 derniers relevés. Ils ne sont plus comptés dans la charge mensuelle.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {closed.map((l) => (
                  <ClosedCard key={l.id} loan={l} onEdit={() => setEditing(l)} onDelete={() => confirm(`Supprimer définitivement ${l.name} ?`) && remove.mutate(l.id)} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <SuggestionsBanner
        onAccept={(s) => {
          setEditing(null);
          setCreating(true);
          setPrefilled({
            name: s.creditor ?? s.label,
            type: 'classic',
            category: 'consumer',
            monthlyPayment: s.monthlyAmount,
            matchPattern: s.matchPattern,
            isActive: true,
            creditor: s.creditor,
            startDate: s.firstSeenDate,
          });
          setSuggestionToAccept(s.id);
        }}
      />

      {(creating || editing) && (
        <LoanForm
          init={prefilled ?? (editing ? toLoanInput(editing) : DEFAULT)}
          onSave={handleSave}
          onCancel={() => {
            setCreating(false);
            setEditing(null);
            setPrefilled(null);
            setSuggestionToAccept(null);
          }}
          busy={create.isPending || update.isPending}
        />
      )}
    </>
  );
}
