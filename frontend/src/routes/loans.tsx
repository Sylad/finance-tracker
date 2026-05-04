import { useState } from 'react';
import { Plus } from 'lucide-react';
import {
  useLoans,
  useCreateLoan,
  useUpdateLoan,
  useDeleteLoan,
  useAcceptSuggestion,
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
  const [editing, setEditing] = useState<Loan | null>(null);
  const [creating, setCreating] = useState(false);
  const [suggestionToAccept, setSuggestionToAccept] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState<LoanInput | null>(null);

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
          <button onClick={() => { setCreating(true); setEditing(null); }} className="btn-primary">
            <Plus className="h-4 w-4" /> Nouveau crédit
          </button>
        }
      />

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
