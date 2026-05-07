import { useRef, useState } from 'react';
import { Plus, Upload, Loader2, CheckCircle2, AlertCircle, X } from 'lucide-react';
import {
  useLoans,
  useCreateLoan,
  useUpdateLoan,
  useDeleteLoan,
  useAcceptSuggestion,
  useImportCreditStatements,
  type CreditStatementImportResult,
} from '@/lib/queries';
import { PageHeader } from '@/components/page-header';
import { LoadingState, EmptyState } from '@/components/loading-state';
import { type Loan, type LoanInput } from '@/types/api';
import { formatEUR } from '@/lib/utils';
import { ClassicCard } from '@/components/loans/classic-card';
import { RevolvingCard } from '@/components/loans/revolving-card';
import { ClosedCard } from '@/components/loans/closed-card';
import { LoanForm } from '@/components/loans/loan-form';
import { SuggestionsBanner } from '@/components/loans/suggestions-banner';
import { LoansMonthlyChart } from '@/components/loans/loans-monthly-chart';
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
  const importCredit = useImportCreditStatements();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<Loan | null>(null);
  const [creating, setCreating] = useState(false);
  const [suggestionToAccept, setSuggestionToAccept] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState<LoanInput | null>(null);
  const [importResult, setImportResult] = useState<CreditStatementImportResult | null>(null);

  const handleCreditUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      const result = await importCredit.mutateAsync(Array.from(files));
      setImportResult(result);
    } catch (e) {
      alert(`Erreur upload : ${(e as Error).message}`);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  if (isLoading) return <LoadingState />;
  const items = data ?? [];
  const classics = items.filter((l) => l.type === 'classic' && l.isActive);
  const revolvings = items.filter((l) => l.type === 'revolving' && l.isActive);
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
              disabled={importCredit.isPending}
              className="btn-secondary"
              title="Importer un ou plusieurs PDF de relevé de crédit. Le N° de contrat sera reconnu automatiquement."
            >
              {importCredit.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Analyse…</>
              ) : (
                <><Upload className="h-4 w-4" /> Relevés crédit (PDF)</>
              )}
            </button>
            <button onClick={() => { setCreating(true); setEditing(null); }} className="btn-primary">
              <Plus className="h-4 w-4" /> Nouveau crédit
            </button>
          </div>
        }
      />

      {importResult && (
        <div className="card p-5 mb-4 relative">
          <button
            onClick={() => setImportResult(null)}
            className="absolute top-3 right-3 text-fg-dim hover:text-fg"
            aria-label="Fermer"
          ><X className="h-4 w-4" /></button>
          <h3 className="font-display text-sm font-semibold text-fg-bright mb-3">Import terminé</h3>
          <ul className="space-y-2">
            {importResult.results.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                {r.error ? (
                  <AlertCircle className="h-4 w-4 text-negative mt-0.5 shrink-0" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-positive mt-0.5 shrink-0" />
                )}
                <span className="flex-1 min-w-0">
                  <span className="font-mono text-xs text-fg-dim">{r.filename}</span>
                  {r.error ? (
                    <span className="block text-negative text-xs">{r.error}</span>
                  ) : (
                    <span className="block text-fg-muted text-xs">
                      {r.created ? '🆕 nouveau crédit' : '🔗 rattaché'} · {r.creditor}
                      {r.accountNumber && <> · #{r.accountNumber}</>}
                      {r.monthlyPayment != null && <> · {formatEUR(r.monthlyPayment)}/mois</>}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {items.length > 0 && <LoansMonthlyChart loans={items} />}

      {items.length === 0 ? (
        <EmptyState title="Aucun crédit déclaré" hint="Ajoute ton crédit immobilier, conso ou ta carte revolving." />
      ) : (
        <div className="space-y-8 mb-6">
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
