import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Target, Trash2, Plus, TrendingUp, Calendar, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/page-header';
import { LoadingState } from '@/components/loading-state';
import { formatEUR, cn } from '@/lib/utils';

type GoalType = 'savings_total' | 'net_worth';
interface GoalWithProgress {
  id: string;
  name: string;
  type: GoalType;
  targetAmount: number;
  targetDate: string | null;
  startAmount: number;
  startDate: string;
  currentAmount: number;
  progressPct: number;
  remaining: number;
  monthlyPaceNeeded: number | null;
  projection: 'on-track' | 'ahead' | 'behind' | 'no-deadline' | 'achieved';
  monthsElapsed: number;
  monthsRemaining: number | null;
}

const TYPE_LABELS: Record<GoalType, string> = {
  savings_total: 'Épargne totale',
  net_worth: 'Patrimoine net',
};

export function GoalsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<GoalWithProgress[]>({
    queryKey: ['goals'],
    queryFn: () => api.get<GoalWithProgress[]>('/goals'),
  });
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<GoalType>('savings_total');
  const [targetAmount, setTargetAmount] = useState('');
  const [targetDate, setTargetDate] = useState('');

  const createGoal = useMutation({
    mutationFn: (body: unknown) => api.post('/goals', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['goals'] });
      setShowForm(false);
      setName(''); setTargetAmount(''); setTargetDate('');
    },
  });
  const removeGoal = useMutation({
    mutationFn: (id: string) => api.delete(`/goals/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  });

  if (isLoading) return <LoadingState label="Chargement…" />;
  const goals = data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Vision long terme"
        title="Objectifs"
        subtitle={`${goals.length} objectif${goals.length > 1 ? 's' : ''} actif${goals.length > 1 ? 's' : ''}.`}
        actions={
          <button onClick={() => setShowForm((v) => !v)} className="btn-primary text-sm">
            <Plus className="h-4 w-4" /> {showForm ? 'Annuler' : 'Nouvel objectif'}
          </button>
        }
      />

      {showForm && (
        <section className="card p-5 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs uppercase tracking-wider text-fg-muted font-semibold">Nom</label>
              <input className="input text-sm mt-1.5 w-full" placeholder="ex: Apport pour appartement" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-fg-muted font-semibold">Type</label>
              <select className="input text-sm mt-1.5 w-full" value={type} onChange={(e) => setType(e.target.value as GoalType)}>
                <option value="savings_total">Épargne totale (cumul des comptes épargne)</option>
                <option value="net_worth">Patrimoine net (épargne + courant − dettes)</option>
              </select>
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-fg-muted font-semibold">Montant cible (€)</label>
              <input className="input text-sm mt-1.5 w-full" type="number" placeholder="25000" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-fg-muted font-semibold">Date cible (optionnel)</label>
              <input className="input text-sm mt-1.5 w-full" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setShowForm(false)} className="btn-ghost text-sm">Annuler</button>
            <button
              onClick={() => createGoal.mutate({ name, type, targetAmount: Number(targetAmount), targetDate: targetDate || null })}
              disabled={!name.trim() || !Number(targetAmount) || createGoal.isPending}
              className="btn-primary text-sm"
            >
              Créer
            </button>
          </div>
        </section>
      )}

      {goals.length === 0 ? (
        <div className="card p-12 text-center text-fg-dim">
          <Target className="h-10 w-10 mx-auto mb-3 text-fg-dim/60" />
          <div className="text-base font-medium mb-1">Aucun objectif pour l'instant</div>
          <div className="text-sm">Donne-toi une cible — l'app suivra ta progression mois après mois.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {goals.map((g) => <GoalCard key={g.id} g={g} onDelete={() => removeGoal.mutate(g.id)} />)}
        </div>
      )}
    </>
  );
}

function GoalCard({ g, onDelete }: { g: GoalWithProgress; onDelete: () => void }) {
  const projColor = {
    'achieved': 'text-positive border-positive/40 bg-positive/10',
    'ahead': 'text-positive border-positive/40 bg-positive/10',
    'on-track': 'text-accent-bright border-accent/40 bg-accent/10',
    'behind': 'text-warning border-warning/40 bg-warning/10',
    'no-deadline': 'text-fg-muted border-border bg-surface-2',
  }[g.projection];
  const projLabel = {
    'achieved': '✓ Atteint',
    'ahead': 'En avance',
    'on-track': 'Dans les temps',
    'behind': 'En retard',
    'no-deadline': 'Sans date cible',
  }[g.projection];

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-wider text-fg-muted font-semibold">{TYPE_LABELS[g.type]}</div>
          <div className="font-display text-lg font-semibold text-fg-bright mt-1">{g.name}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn('text-[10px] uppercase tracking-wider font-bold border rounded-full px-2 py-0.5', projColor)}>
            {projLabel}
          </span>
          <button onClick={onDelete} className="text-fg-muted hover:text-negative" title="Supprimer">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-4 flex items-baseline justify-between">
        <div className="font-display text-3xl font-bold tabular text-fg-bright">{formatEUR(g.currentAmount)}</div>
        <div className="text-sm text-fg-muted tabular">/ {formatEUR(g.targetAmount)}</div>
      </div>

      <div className="mt-3 h-2 bg-surface-2 rounded-full overflow-hidden">
        <div
          className={cn(
            'h-full transition-all',
            g.projection === 'achieved' || g.projection === 'ahead' ? 'bg-positive'
              : g.projection === 'behind' ? 'bg-warning'
                : 'bg-accent',
          )}
          style={{ width: `${g.progressPct}%` }}
        />
      </div>
      <div className="mt-1 text-xs text-fg-muted flex items-center justify-between">
        <span>{g.progressPct}% · reste {formatEUR(g.remaining)}</span>
        <span>{formatEUR(g.startAmount)} → {formatEUR(g.targetAmount)}</span>
      </div>

      {g.targetDate && (
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-2 text-fg-muted">
            <Calendar className="h-3.5 w-3.5" />
            <span className="text-xs">Échéance</span>
          </div>
          <div className="text-right tabular text-fg">{new Date(g.targetDate).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}</div>

          {g.monthsRemaining != null && (
            <>
              <div className="flex items-center gap-2 text-fg-muted">
                <TrendingUp className="h-3.5 w-3.5" />
                <span className="text-xs">Rythme nécessaire</span>
              </div>
              <div className="text-right tabular text-fg">
                {g.monthsRemaining > 0
                  ? `${formatEUR(g.monthlyPaceNeeded ?? 0)} / mois (${g.monthsRemaining} mois restants)`
                  : 'Échéance dépassée'}
              </div>
            </>
          )}
        </div>
      )}

      {g.projection === 'achieved' && (
        <div className="mt-4 flex items-center gap-2 text-positive text-sm">
          <CheckCircle2 className="h-4 w-4" />
          Bravo, objectif atteint.
        </div>
      )}
    </div>
  );
}
