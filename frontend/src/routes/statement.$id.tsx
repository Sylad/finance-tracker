import { useState, useMemo } from 'react';
import { useParams, Link, useNavigate } from '@tanstack/react-router';
import {
  ArrowLeft,
  ArrowDownRight,
  ArrowUpRight,
  Trash2,
  Search,
  Languages,
  Loader2,
  AlertCircle,
  AlertTriangle,
  Info,
  Copy,
  Sparkles,
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { useQuery } from '@tanstack/react-query';
import { useStatement, useDeleteStatement, useReanalyzeStatement } from '@/lib/queries';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/page-header';
import { LoadingState } from '@/components/loading-state';
import { ScoreRing } from '@/components/score-ring';
import { CategoryPicker } from '@/components/category-picker';
import { TxRow, CATEGORY_COLOR } from '@/components/tx-row';
import { AutoCategorizeModal } from '@/components/auto-categorize-modal';
import { CategorizationQualityCard } from '@/components/categorization-quality-card';
import {
  CATEGORY_LABELS,
  type Transaction,
  type TransactionCategory,
} from '@/types/api';
import { formatEUR, formatMonth, cn, chartTooltipProps, prevMonthId } from '@/lib/utils';
import { transactionMatchesSearch } from '@/lib/category-label';

interface AnomalyDto {
  type: 'duplicate' | 'bank_fee_spike' | 'large_outlier' | 'new_recurring';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  transactionIds: string[];
}

function categoryTotalsFor(transactions: Transaction[]): Map<TransactionCategory, number> {
  const map = new Map<TransactionCategory, number>();
  for (const t of transactions) {
    if (t.amount < 0) {
      map.set(t.category, (map.get(t.category) ?? 0) + Math.abs(t.amount));
    }
  }
  return map;
}

export function StatementDetailPage() {
  const { id } = useParams({ from: '/history/$id' });
  const { data, isLoading } = useStatement(id);
  const prevId = prevMonthId(id);
  // Best-effort fetch of the previous statement for delta comparisons.
  // It's OK if it doesn't exist (first month, missing import) — we just hide the deltas.
  const { data: prev } = useStatement(prevId ?? undefined);
  const del = useDeleteStatement();
  const reanalyze = useReanalyzeStatement();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'credit' | 'debit'>('all');
  const [activeCat, setActiveCat] = useState<TransactionCategory | null>(null);
  const [pickingTx, setPickingTx] = useState<Transaction | null>(null);
  const [autoCatOpen, setAutoCatOpen] = useState(false);

  const transactions = data?.transactions ?? [];
  const otherCount = useMemo(() => transactions.filter((t) => t.category === 'other').length, [transactions]);

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      if (filter === 'credit' && t.amount < 0) return false;
      if (filter === 'debit' && t.amount > 0) return false;
      if (activeCat && t.category !== activeCat) return false;
      if (search.trim()) {
        return transactionMatchesSearch(t, search);
      }
      return true;
    });
  }, [transactions, filter, activeCat, search]);

  const prevTotals = useMemo(() => prev ? categoryTotalsFor(prev.transactions) : null, [prev]);

  const categoryBreakdown = useMemo(() => {
    const totals = categoryTotalsFor(transactions);
    return Array.from(totals.entries())
      .map(([cat, total]) => {
        const prevValue = prevTotals?.get(cat) ?? null;
        const delta = prevValue != null ? total - prevValue : null;
        const deltaPct = prevValue && prevValue > 0 ? ((total - prevValue) / prevValue) * 100 : null;
        return {
          category: cat,
          label: CATEGORY_LABELS[cat],
          value: Math.round(total * 100) / 100,
          color: CATEGORY_COLOR[cat],
          prevValue,
          delta,
          deltaPct,
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [transactions, prevTotals]);

  // Header-level deltas (computed against the previous statement when available)
  const debitsDelta = prev ? data ? data.totalDebits - prev.totalDebits : null : null;
  const debitsDeltaPct = prev && prev.totalDebits > 0 && data ? ((data.totalDebits - prev.totalDebits) / prev.totalDebits) * 100 : null;
  const scoreDelta = prev && data ? data.healthScore.total - prev.healthScore.total : null;

  // Anomaly detection (server-side, deterministic)
  const { data: anomaliesData } = useQuery<{ anomalies: AnomalyDto[] }>({
    queryKey: ['statement', id, 'anomalies'],
    queryFn: () => api.get(`/statements/${id}/anomalies`),
    enabled: !!id,
  });
  const anomalies = anomaliesData?.anomalies ?? [];

  if (isLoading) return <LoadingState label="Récupération du relevé…" />;
  if (!data) return (
    <div className="card p-8 text-center">
      <div className="text-negative font-medium">Relevé introuvable</div>
      <div className="text-xs text-fg-muted mt-1.5">L'identifiant {id} n'existe pas (ou plus) en base.</div>
    </div>
  );

  const handleDelete = async () => {
    if (!confirm('Supprimer définitivement ce relevé ?')) return;
    await del.mutateAsync(id);
    navigate({ to: '/history' });
  };

  const handleReanalyze = () => {
    if (!id) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) await reanalyze.mutateAsync({ id, file }).catch(() => {});
    };
    input.click();
  };

  return (
    <>
      <Link
        to="/history"
        className="inline-flex items-center gap-2 text-sm text-fg-muted hover:text-fg mb-4"
      >
        <ArrowLeft className="h-4 w-4" /> Historique
      </Link>

      <PageHeader
        eyebrow={data.bankName}
        title={formatMonth(data.month, data.year)}
        subtitle={`${data.transactions.length} transactions · ${data.accountHolder}`}
        actions={
          <div className="flex items-center gap-2">
            {otherCount > 0 && (
              <button
                onClick={() => setAutoCatOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent/10 hover:bg-accent/20 text-accent-bright text-xs font-medium border border-accent/30 transition-colors"
                title={`${otherCount} transaction${otherCount > 1 ? 's' : ''} dans "Autre"`}
              >
                <Sparkles className="h-3.5 w-3.5" /> Auto-catégoriser ({otherCount})
              </button>
            )}
            <button onClick={handleDelete} disabled={del.isPending} className="btn-danger">
              <Trash2 className="h-3.5 w-3.5" /> Supprimer
            </button>
          </div>
        }
      />

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <h2 className="sr-only">Chiffres du mois</h2>
        <div className="card p-5">
          <div className="stat-label">Crédits</div>
          <div className="font-display text-xl font-semibold tabular text-positive mt-2 flex items-center gap-1.5">
            <ArrowUpRight className="h-4 w-4" /> {formatEUR(data.totalCredits)}
          </div>
        </div>
        <div className="card p-5">
          <div className="stat-label">Débits</div>
          <div className="font-display text-xl font-semibold tabular text-negative mt-2 flex items-center gap-1.5">
            <ArrowDownRight className="h-4 w-4" /> {formatEUR(data.totalDebits)}
          </div>
          {prev && debitsDelta != null && (
            <DeltaBadge delta={debitsDelta} pct={debitsDeltaPct} prevMonth={formatMonth(prev.month, prev.year)} invertColors />
          )}
        </div>
        <div className="card p-5">
          <div className="stat-label">Solde de clôture</div>
          <div className="font-display text-xl font-semibold tabular text-fg-bright mt-2">
            {formatEUR(data.closingBalance)}
          </div>
          <div className="text-xs text-fg-dim mt-1">
            ouverture : {formatEUR(data.openingBalance)}
          </div>
        </div>
        <div className="card p-5 relative">
          <div className={cn('transition-opacity', reanalyze.isPending && 'opacity-30')}>
            <div className="flex items-center gap-4">
              <ScoreRing score={data.healthScore.total} size={70} strokeWidth={6} />
              <div className="stat-label flex items-center gap-2">
                Score
                {scoreDelta != null && scoreDelta !== 0 && (
                  <span className={cn('text-[10px] font-semibold tabular', scoreDelta > 0 ? 'text-positive' : 'text-negative')}>
                    {scoreDelta > 0 ? '↑+' : '↓'}{scoreDelta} pts
                  </span>
                )}
              </div>
            </div>
            <p className="text-xs text-fg-muted mt-3 leading-relaxed">
              {data.healthScore.claudeComment}
            </p>
            <button
              onClick={handleReanalyze}
              disabled={reanalyze.isPending}
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent/10 hover:bg-accent/20 text-accent-bright text-xs font-medium border border-accent/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {reanalyze.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Languages className="h-3.5 w-3.5" />}
              {reanalyze.isPending ? 'Analyse en cours…' : 'Re-analyser en français'}
            </button>
          </div>
          {reanalyze.isPending && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-surface/95 border border-accent/40 shadow-lg">
                <Loader2 className="h-4 w-4 animate-spin text-accent-bright" />
                <span className="text-xs font-medium text-fg-bright">Claude analyse ton relevé… (~30 s)</span>
              </div>
            </div>
          )}
        </div>
      </section>

      {transactions.length > 0 && (
        <section className="mb-6">
          <h2 className="sr-only">Qualité de la catégorisation</h2>
          <CategorizationQualityCard transactions={transactions} />
        </section>
      )}

      {anomalies.length > 0 && (
        <section className="card p-5 mb-6">
          <h2 className="stat-label mb-3 flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-warning" aria-hidden="true" />
            Anomalies détectées ({anomalies.length})
          </h2>
          <div className="space-y-2">
            {anomalies.map((a, i) => <AnomalyRow key={i} a={a} />)}
          </div>
        </section>
      )}

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="card p-5 lg:col-span-1">
          <h2 className="stat-label mb-4">Répartition des dépenses</h2>
          {categoryBreakdown.length > 0 ? (
            <>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categoryBreakdown}
                      dataKey="value"
                      nameKey="label"
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={75}
                      paddingAngle={2}
                      onClick={(d) =>
                        setActiveCat((cur) => (cur === d.category ? null : d.category as TransactionCategory))
                      }
                    >
                      {categoryBreakdown.map((b) => (
                        <Cell
                          key={b.category}
                          fill={b.color}
                          stroke="hsl(var(--surface))"
                          strokeWidth={1}
                          opacity={activeCat && activeCat !== b.category ? 0.3 : 1}
                          className="cursor-pointer transition-opacity"
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      {...chartTooltipProps}
                      formatter={(v: number, name: string) => [formatEUR(v), name]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1.5 mt-3 max-h-52 overflow-auto pr-1">
                {categoryBreakdown.map((b) => (
                  <button
                    key={b.category}
                    onClick={() => setActiveCat((c) => (c === b.category ? null : b.category))}
                    aria-pressed={activeCat === b.category}
                    className={cn(
                      'w-full flex items-center justify-between text-xs px-2 py-1.5 rounded transition-colors',
                      activeCat === b.category ? 'bg-surface-2' : 'hover:bg-surface-2/50',
                    )}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: b.color }} />
                      <span className="text-fg truncate">{b.label}</span>
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      <CategoryDelta prevValue={b.prevValue} delta={b.delta} deltaPct={b.deltaPct} />
                      <span className="text-fg-muted tabular">{formatEUR(b.value)}</span>
                    </span>
                  </button>
                ))}
                {prev && categoriesAbsentThisMonth(prevTotals, categoryBreakdown).map((cat) => (
                  <div key={cat} className="w-full flex items-center justify-between text-xs px-2 py-1.5 rounded opacity-60">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="h-2.5 w-2.5 rounded-sm shrink-0 bg-fg-dim" />
                      <span className="text-fg-muted truncate italic">{CATEGORY_LABELS[cat]}</span>
                    </span>
                    <span className="text-positive text-[10px] tabular">disparu</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-fg-dim italic py-12 text-center">
              Pas de dépense ce mois-ci.
            </p>
          )}
        </div>

        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <h2 className="sr-only">Transactions</h2>
            <div className="stat-label" role="status">
              {filtered.length} / {transactions.length} transaction{transactions.length > 1 ? 's' : ''}
              {activeCat && (
                <button
                  onClick={() => setActiveCat(null)}
                  className="ml-2 badge-info text-[10px]"
                >
                  {CATEGORY_LABELS[activeCat]} ✕
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div role="group" aria-label="Sens des transactions" className="flex bg-surface-2 rounded p-0.5 text-xs">
                {(['all', 'credit', 'debit'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    aria-pressed={filter === f}
                    className={cn(
                      'px-2.5 py-1 rounded transition-colors font-medium',
                      filter === f ? 'bg-surface-3 text-fg-bright' : 'text-fg-muted hover:text-fg',
                    )}
                  >
                    {f === 'all' ? 'Tout' : f === 'credit' ? 'Crédit' : 'Débit'}
                  </button>
                ))}
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg-dim" aria-hidden="true" />
                <input
                  aria-label="Filtrer les transactions"
                  className="input pl-8 py-1.5 text-xs w-44"
                  placeholder="Filtrer..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
          </div>
          <ul
            tabIndex={0}
            aria-label="Transactions du relevé"
            className="divide-y divide-border lg:max-h-[min(640px,70vh)] lg:overflow-auto"
          >
            {filtered.map((t) => <TxRow key={t.id} t={t} onPickCategory={setPickingTx} />)}
            {filtered.length === 0 && (
              <li className="text-sm text-fg-dim italic py-8 text-center">
                Aucune transaction.
              </li>
            )}
          </ul>
        </div>
      </section>

      {data.analysisNarrative && (
        <section className="card p-5 relative">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="stat-label">Analyse Claude</h2>
            <button
              onClick={handleReanalyze}
              disabled={reanalyze.isPending}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-accent/10 hover:bg-accent/20 text-accent-bright text-xs font-medium border border-accent/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {reanalyze.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Languages className="h-3 w-3" />}
              {reanalyze.isPending ? 'Analyse en cours…' : 'Re-analyser en français'}
            </button>
          </div>
          <p className={cn('text-sm text-fg leading-relaxed whitespace-pre-line transition-opacity', reanalyze.isPending && 'opacity-30')}>
            {data.analysisNarrative}
          </p>
          {reanalyze.isPending && (
            <div className="absolute inset-x-0 bottom-4 flex items-center justify-center pointer-events-none">
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-surface/95 border border-accent/40 shadow-lg">
                <Loader2 className="h-4 w-4 animate-spin text-accent-bright" />
                <span className="text-xs font-medium text-fg-bright">Claude analyse ton relevé… (~30 s)</span>
              </div>
            </div>
          )}
          {reanalyze.isError && (
            <div className="mt-3 flex items-start gap-2 p-3 rounded-md bg-negative/10 border border-negative/40 text-sm">
              <AlertCircle className="h-4 w-4 text-negative shrink-0 mt-0.5" />
              <div>
                <div className="font-medium text-negative">Échec de la ré-analyse</div>
                <div className="text-xs text-fg-muted mt-0.5">{(reanalyze.error as Error)?.message ?? 'Erreur inconnue'}</div>
              </div>
            </div>
          )}
        </section>
      )}

      {pickingTx && (
        <CategoryPicker statementId={id} tx={pickingTx} onClose={() => setPickingTx(null)} />
      )}

      {autoCatOpen && (
        <AutoCategorizeModal statementId={id} onClose={() => setAutoCatOpen(false)} />
      )}
    </>
  );
}

function AnomalyRow({ a }: { a: AnomalyDto }) {
  const Icon = a.severity === 'critical' ? AlertCircle : a.severity === 'warning' ? AlertTriangle : Info;
  const tone = a.severity === 'critical'
    ? 'text-negative bg-negative/10 border-negative/40'
    : a.severity === 'warning'
      ? 'text-warning bg-warning/10 border-warning/40'
      : 'text-fg-muted bg-surface-2 border-border';
  const TypeIcon = a.type === 'duplicate' ? Copy : Icon;
  return (
    <div className={cn('flex items-start gap-3 px-3 py-2.5 rounded-md border', tone)}>
      <TypeIcon className="h-4 w-4 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{a.title}</div>
        <div className="text-xs opacity-90 mt-0.5">{a.detail}</div>
      </div>
    </div>
  );
}

function categoriesAbsentThisMonth(
  prev: Map<TransactionCategory, number> | null,
  current: { category: TransactionCategory }[],
): TransactionCategory[] {
  if (!prev) return [];
  const currentSet = new Set(current.map((c) => c.category));
  return Array.from(prev.keys()).filter((c) => !currentSet.has(c));
}

function CategoryDelta({ prevValue, delta, deltaPct }: { prevValue: number | null; delta: number | null; deltaPct: number | null }) {
  if (prevValue == null) {
    return <span className="text-[10px] uppercase tracking-wider text-positive font-semibold">nouveau</span>;
  }
  if (delta == null || Math.abs(delta) < 0.01) {
    return <span className="text-[10px] tabular text-fg-dim">=</span>;
  }
  const up = delta > 0;
  // For expenses, going UP is bad (red), going DOWN is good (green).
  return (
    <span className={cn('text-[10px] tabular font-semibold', up ? 'text-negative' : 'text-positive')}>
      {up ? '↑' : '↓'}{deltaPct != null ? `${Math.abs(Math.round(deltaPct))}%` : formatEUR(Math.abs(delta))}
    </span>
  );
}

function DeltaBadge({ delta, pct, prevMonth, invertColors }: { delta: number; pct: number | null; prevMonth: string; invertColors?: boolean }) {
  if (Math.abs(delta) < 0.01) {
    return <div className="text-[10px] text-fg-dim mt-1">= vs {prevMonth}</div>;
  }
  const up = delta > 0;
  // For debits we invert: more debits = bad (red), less = good (green).
  const isBad = invertColors ? up : !up;
  return (
    <div className={cn('text-[10px] tabular font-semibold mt-1', isBad ? 'text-negative' : 'text-positive')}>
      {up ? '↑+' : '↓'}{pct != null ? `${Math.abs(Math.round(pct))}%` : ''} {formatEUR(Math.abs(delta))} vs {prevMonth}
    </div>
  );
}

