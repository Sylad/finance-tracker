import { useEffect, useState } from 'react';
import { Save, Check } from 'lucide-react';
import { useBudget, useUpdateBudget } from '@/lib/queries';
import { PageHeader } from '@/components/page-header';
import { LoadingState } from '@/components/loading-state';
import { CATEGORY_LABELS, EXPENSE_CATEGORIES, type Budget, type TransactionCategory } from '@/types/api';

export function BudgetPage() {
  const { data, isLoading } = useBudget();
  const update = useUpdateBudget();
  const [draft, setDraft] = useState<Budget>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => { if (data) setDraft(data); }, [data]);

  const handleSave = async () => {
    await update.mutateAsync(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (isLoading) return <LoadingState />;

  return (
    <>
      <PageHeader
        title="Budget"
        subtitle="Définis un plafond mensuel par catégorie. Le dashboard affichera la progression à chaque relevé."
        actions={
          <button onClick={handleSave} disabled={update.isPending} className="btn-primary">
            {saved ? <><Check className="h-4 w-4" /> Enregistré</> : <><Save className="h-4 w-4" /> Enregistrer</>}
          </button>
        }
      />

      <div className="card divide-y divide-border max-w-2xl">
        {EXPENSE_CATEGORIES.map((cat) => (
          <div key={cat} className="flex items-center justify-between gap-4 px-5 py-4">
            <div className="text-sm font-medium text-fg-bright flex-1">
              {CATEGORY_LABELS[cat]}
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={10}
                value={draft[cat as TransactionCategory] ?? ''}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  setDraft((d) => ({
                    ...d,
                    [cat]: v ? Number(v) : undefined,
                  }));
                }}
                placeholder="—"
                className="input w-28 text-right tabular"
              />
              <span className="text-fg-dim text-sm">€</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
