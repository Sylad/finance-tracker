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
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { useStatement, useDeleteStatement, useReanalyzeStatement } from '@/lib/queries';
import { PageHeader } from '@/components/page-header';
import { LoadingState } from '@/components/loading-state';
import { ScoreRing } from '@/components/score-ring';
import { CategoryPicker } from '@/components/category-picker';
import {
  CATEGORY_LABELS,
  type Transaction,
  type TransactionCategory,
} from '@/types/api';
import { formatEUR, formatMonth, formatDate, cn, chartTooltipProps, prevMonthId } from '@/lib/utils';
import { recognizeMerchant } from '@/lib/merchants';

const CATEGORY_COLOR: Record<TransactionCategory, string> = {
  income: 'hsl(160 84% 50%)',
  housing: 'hsl(217 91% 60%)',
  transport: 'hsl(45 93% 50%)',
  food: 'hsl(280 85% 65%)',
  health: 'hsl(0 84% 60%)',
  entertainment: 'hsl(330 85% 60%)',
  subscriptions: 'hsl(195 83% 50%)',
  savings: 'hsl(140 70% 45%)',
  transfers: 'hsl(220 12% 50%)',
  taxes: 'hsl(20 90% 55%)',
  other: 'hsl(220 8% 40%)',
};

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

  const transactions = data?.transactions ?? [];

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      if (filter === 'credit' && t.amount < 0) return false;
      if (filter === 'debit' && t.amount > 0) return false;
      if (activeCat && t.category !== activeCat) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return t.description.toLowerCase().includes(q) ||
          t.subcategory.toLowerCase().includes(q);
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
          <button onClick={handleDelete} disabled={del.isPending} className="btn-danger">
            <Trash2 className="h-3.5 w-3.5" /> Supprimer
          </button>
        }
      />

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
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
        <div className="card p-5 flex items-start gap-4 relative">
          <ScoreRing score={data.healthScore.total} size={70} strokeWidth={6} />
          <div className={cn('flex-1 min-w-0 transition-opacity', reanalyze.isPending && 'opacity-30')}>
            <div className="stat-label flex items-center gap-2">
              Score
              {scoreDelta != null && scoreDelta !== 0 && (
                <span className={cn('text-[10px] font-semibold tabular', scoreDelta > 0 ? 'text-positive' : 'text-negative')}>
                  {scoreDelta > 0 ? '↑+' : '↓'}{scoreDelta} pts
                </span>
              )}
            </div>
            <div className="text-xs text-fg-muted mt-1.5 leading-relaxed line-clamp-3">
              {data.healthScore.claudeComment}
            </div>
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

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="card p-5 lg:col-span-1">
          <div className="stat-label mb-4">Répartition des dépenses</div>
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
            <div className="stat-label">
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
              <div className="flex bg-surface-2 rounded p-0.5 text-xs">
                {(['all', 'credit', 'debit'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
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
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg-dim" />
                <input
                  className="input pl-8 py-1.5 text-xs w-44"
                  placeholder="Filtrer..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
          </div>
          <div className="divide-y divide-border max-h-[640px] overflow-auto">
            {filtered.map((t) => <TxRow key={t.id} t={t} onPickCategory={setPickingTx} />)}
            {filtered.length === 0 && (
              <div className="text-sm text-fg-dim italic py-8 text-center">
                Aucune transaction.
              </div>
            )}
          </div>
        </div>
      </section>

      {data.analysisNarrative && (
        <section className="card p-5 relative">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="stat-label">Analyse Claude</div>
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
    </>
  );
}

function MerchantAvatar({ merchant, fallback }: { merchant: { name: string; faviconUrl: string } | null; fallback: string }) {
  const [errored, setErrored] = useState(false);
  if (merchant && !errored) {
    return (
      <img
        src={merchant.faviconUrl}
        alt={merchant.name}
        className="h-6 w-6 rounded shrink-0 bg-surface-2 object-contain p-0.5"
        onError={() => setErrored(true)}
        loading="lazy"
      />
    );
  }
  // Fallback: coloured square with the first uppercase letter
  const initial = (merchant?.name ?? fallback).trim().match(/[A-Za-z0-9]/)?.[0]?.toUpperCase() ?? '?';
  return (
    <div className="h-6 w-6 rounded shrink-0 flex items-center justify-center bg-surface-2 text-fg-muted text-[10px] font-bold">
      {initial}
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

function TxRow({ t, onPickCategory }: { t: Transaction; onPickCategory: (t: Transaction) => void }) {
  const positive = t.amount > 0;
  const knownCat = (Object.keys(CATEGORY_LABELS) as TransactionCategory[]).includes(t.category);
  const color = knownCat ? CATEGORY_COLOR[t.category] : 'hsl(220 12% 50%)';
  const label = knownCat ? CATEGORY_LABELS[t.category] : t.category;
  const merchant = recognizeMerchant(t.description);
  return (
    <div className="grid grid-cols-12 gap-3 items-center px-2 py-2.5 text-sm">
      <div className="col-span-2 text-xs text-fg-dim tabular">{formatDate(t.date)}</div>
      <div className="col-span-5 min-w-0 flex items-center gap-2.5">
        <MerchantAvatar merchant={merchant} fallback={t.description} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-fg font-medium">{merchant?.name ?? t.description}</div>
          <div className="text-[10px] text-fg-dim uppercase tracking-wider mt-0.5 truncate">
            {merchant ? <span className="normal-case lowercase italic mr-2 text-fg-dim/80">{t.description}</span> : null}
            {t.subcategory || label}
            {t.isRecurring && <span className="ml-2 text-accent-bright">· récurrent</span>}
          </div>
        </div>
      </div>
      <div className="col-span-2">
        <button
          onClick={() => onPickCategory(t)}
          className="badge text-[10px] cursor-pointer hover:ring-1 hover:ring-accent transition"
          style={{ background: `${color}20`, color }}
          title="Modifier la catégorie"
        >
          {label}
        </button>
      </div>
      <div className={cn(
        'col-span-3 text-right tabular font-medium',
        positive ? 'text-positive' : 'text-fg-bright',
      )}>
        {formatEUR(t.amount, positive)}
      </div>
    </div>
  );
}
