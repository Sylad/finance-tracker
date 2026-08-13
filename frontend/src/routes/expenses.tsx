import { useMemo, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Loader2, Sparkles, AlertCircle, Scissors, Repeat, ShoppingBag, HelpCircle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { PageHeader } from '@/components/page-header';
import { LoadingState, EmptyState } from '@/components/loading-state';
import { CATEGORY_LABELS, type StatementSummary, type TransactionCategory } from '@/types/api';
import { formatEUR, formatDate, cn, chartTooltipProps } from '@/lib/utils';

interface ExpenseTx { id: string; date: string; description: string; amount: number }
interface Breakdown {
  monthId: string;
  totalDebits: number;
  buckets: Record<'credits' | 'subscriptions' | 'savings' | 'neutral', { total: number; transactions: ExpenseTx[] }>;
  categories: Array<{ category: string; total: number; count: number; transactions: ExpenseTx[] }>;
}
interface CutSuggestion {
  key: string; label: string; kind: 'abonnement' | 'achat_ponctuel' | 'autre';
  cuttable: boolean; monthlyEstimate: number; monthsSeen: number; occurrences: number;
  lastSeenDate: string; advice: string; sampleAmounts: number[];
}
interface CutResult {
  suggestions: CutSuggestion[]; analyzedClusters: number; skippedClusters: number;
  months: string[]; errors: string[];
}

const BUCKET_META: Record<string, { label: string; color: string; hint: string }> = {
  credits: { label: 'Crédits', color: 'hsl(0 60% 45%)', hint: 'Mensualités rattachées à tes crédits — à traiter via le plan de remboursement, pas coupables ici.' },
  subscriptions: { label: 'Abonnements connus', color: 'hsl(195 83% 50%)', hint: 'Abonnements déjà suivis sur la page Abonnements.' },
  savings: { label: 'Épargne', color: 'hsl(140 70% 45%)', hint: 'Virements vers tes comptes épargne — pas une dépense.' },
  neutral: { label: 'Opérations neutres', color: 'hsl(220 10% 45%)', hint: 'Débits compensés par un crédit équivalent à ±7 jours (remboursements redirigés, annulations).' },
};

const CATEGORY_COLOR: Record<string, string> = {
  income: 'hsl(160 84% 50%)', housing: 'hsl(217 91% 60%)', transport: 'hsl(45 93% 50%)',
  food: 'hsl(280 85% 65%)', health: 'hsl(0 84% 60%)', entertainment: 'hsl(330 85% 60%)',
  subscriptions: 'hsl(195 60% 65%)', savings: 'hsl(140 70% 45%)', transfers: 'hsl(25 90% 55%)',
  taxes: 'hsl(0 0% 60%)', other: 'hsl(260 40% 60%)',
};

const KIND_META = {
  abonnement: { label: 'Abonnements détectés', icon: Repeat, color: 'text-accent' },
  achat_ponctuel: { label: 'Achats ponctuels', icon: ShoppingBag, color: 'text-warning' },
  autre: { label: 'Autres', icon: HelpCircle, color: 'text-fg-muted' },
} as const;

export function ExpensesPage() {
  const [monthId, setMonthId] = useState<string | null>(null);
  const [activeSlice, setActiveSlice] = useState<string | null>(null);
  const [cutResult, setCutResult] = useState<CutResult | null>(null);
  const [ollamaDown, setOllamaDown] = useState<string | null>(null);

  const { data: statements } = useQuery<StatementSummary[]>({
    queryKey: ['statements'],
    queryFn: () => api.get<StatementSummary[]>('/statements'),
  });
  const { data, isLoading } = useQuery<Breakdown>({
    queryKey: ['expenses-breakdown', monthId],
    queryFn: () => api.get<Breakdown>(`/expenses/breakdown${monthId ? `?monthId=${monthId}` : ''}`),
  });

  const proposeCuts = useMutation({
    mutationFn: () => api.post<CutResult>('/expenses/cut-suggestions'),
  });

  const handleCuts = async () => {
    setOllamaDown(null);
    try {
      setCutResult(await proposeCuts.mutateAsync());
    } catch (e) {
      if (e instanceof ApiError && e.status === 502) setOllamaDown(e.message);
      else alert(`Erreur analyse : ${(e as Error).message}`);
    }
  };

  const slices = useMemo(() => {
    if (!data) return [];
    const bucketSlices = (Object.keys(BUCKET_META) as Array<keyof Breakdown['buckets']>)
      .filter((k) => data.buckets[k].total > 0)
      .map((k) => ({
        id: `bucket:${k}`,
        label: BUCKET_META[k].label,
        value: data.buckets[k].total,
        color: BUCKET_META[k].color,
        transactions: data.buckets[k].transactions,
        hint: BUCKET_META[k].hint,
      }));
    const catSlices = data.categories.map((c) => ({
      id: `cat:${c.category}`,
      label: CATEGORY_LABELS[c.category as TransactionCategory] ?? c.category,
      value: c.total,
      color: CATEGORY_COLOR[c.category] ?? 'hsl(260 40% 60%)',
      transactions: c.transactions,
      hint: null as string | null,
    }));
    return [...bucketSlices, ...catSlices];
  }, [data]);

  const active = slices.find((s) => s.id === activeSlice) ?? null;

  if (isLoading && !data) return <LoadingState />;

  return (
    <>
      <PageHeader
        eyebrow="Dépenses"
        title={data ? `${formatEUR(data.totalDebits)} de retraits` : 'Dépenses'}
        subtitle={data ? `Relevé ${data.monthId} — crédits, abonnements et opérations neutres isolés` : ''}
        actions={
          <div className="flex gap-2 items-center">
            <select
              value={monthId ?? data?.monthId ?? ''}
              onChange={(e) => { setMonthId(e.target.value); setActiveSlice(null); }}
              className="bg-surface-2 border border-border rounded-md px-3 py-2 text-sm text-fg"
            >
              {(statements ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.id}</option>
              ))}
            </select>
            <button
              onClick={handleCuts}
              disabled={proposeCuts.isPending}
              className="btn-secondary"
              title="Analyse les 3 derniers mois via le LLM local (Ollama) et propose des dépenses à couper : abonnements, achats, autres. Crédits exclus. Peut durer 1-3 min."
            >
              {proposeCuts.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Analyse en cours sur la 5090…</>
              ) : (
                <><Sparkles className="h-4 w-4" /> Proposer des coupes (IA locale)</>
              )}
            </button>
          </div>
        }
      />

      {ollamaDown && (
        <div className="card p-4 mb-4 border-negative/40 text-sm">
          <div className="flex items-center gap-2 text-negative font-semibold">
            <AlertCircle className="h-4 w-4" /> Analyse indisponible — Ollama éteint ?
          </div>
          <p className="text-fg-muted text-xs mt-1">{ollamaDown}</p>
        </div>
      )}

      {!data ? (
        <EmptyState title="Aucun relevé" hint="Importe un relevé bancaire pour voir tes dépenses." />
      ) : (
        <div className="grid lg:grid-cols-2 gap-4 mb-4">
          <div className="card p-5">
            <h3 className="font-display text-sm font-semibold text-fg-bright mb-2">Répartition des retraits</h3>
            <div className="h-64">
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={slices}
                    dataKey="value"
                    nameKey="label"
                    cx="50%" cy="50%"
                    innerRadius={50} outerRadius={85}
                    paddingAngle={2}
                    onClick={(d) => setActiveSlice((cur) => (cur === (d as { id?: string }).id ? null : (d as { id?: string }).id ?? null))}
                  >
                    {slices.map((s) => (
                      <Cell
                        key={s.id}
                        fill={s.color}
                        opacity={activeSlice && activeSlice !== s.id ? 0.35 : 1}
                        cursor="pointer"
                      />
                    ))}
                  </Pie>
                  <Tooltip {...chartTooltipProps} formatter={(v) => formatEUR(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-3 space-y-1">
              {slices.map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => setActiveSlice((cur) => (cur === s.id ? null : s.id))}
                    className={cn(
                      'w-full flex items-center gap-2 text-sm px-2 py-1 rounded-md transition-colors',
                      activeSlice === s.id ? 'bg-surface-2 text-fg-bright' : 'text-fg-muted hover:bg-surface-2/60',
                    )}
                  >
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                    <span className="flex-1 text-left truncate">{s.label}</span>
                    <span className="font-mono text-xs">{formatEUR(s.value)}</span>
                    <span className="text-[10px] text-fg-dim w-12 text-right">
                      {((s.value / data.totalDebits) * 100).toFixed(1)} %
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="card p-5">
            <h3 className="font-display text-sm font-semibold text-fg-bright mb-2">
              {active ? `${active.label} — ${active.transactions.length} retrait${active.transactions.length > 1 ? 's' : ''}` : 'Détail'}
            </h3>
            {!active ? (
              <p className="text-sm text-fg-dim italic py-8 text-center">
                Clique sur une part du camembert (ou une ligne de légende) pour voir les retraits correspondants.
              </p>
            ) : (
              <>
                {active.hint && <p className="text-xs text-fg-dim mb-3">{active.hint}</p>}
                <div className="max-h-80 overflow-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {active.transactions.map((t) => (
                        <tr key={t.id} className="border-b border-border/50 last:border-0">
                          <td className="py-1.5 pr-3 text-fg-dim text-xs whitespace-nowrap">{formatDate(t.date)}</td>
                          <td className="py-1.5 pr-3 text-fg truncate max-w-[220px]">{t.description}</td>
                          <td className="py-1.5 text-right font-mono text-negative whitespace-nowrap">{formatEUR(t.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {cutResult && (
        <div className="card p-5 mb-4">
          <div className="flex items-center gap-2 mb-1">
            <Scissors className="h-4 w-4 text-accent" />
            <h3 className="font-display text-sm font-semibold text-fg-bright">
              Coupes proposées (IA locale — {cutResult.months.join(', ')})
            </h3>
          </div>
          <p className="text-xs text-fg-dim mb-4">
            {cutResult.analyzedClusters} groupes de dépenses analysés (crédits, abonnements connus, épargne et
            opérations neutres exclus){cutResult.skippedClusters > 0 && <> · {cutResult.skippedClusters} petits groupes ignorés</>}
            {cutResult.errors.length > 0 && <span className="text-warning"> · {cutResult.errors.length} lot(s) en erreur</span>}
          </p>
          {(['abonnement', 'achat_ponctuel', 'autre'] as const).map((kind) => {
            const items = cutResult.suggestions.filter((s) => s.kind === kind);
            if (items.length === 0) return null;
            const Meta = KIND_META[kind];
            const Icon = Meta.icon;
            return (
              <div key={kind} className="mb-4 last:mb-0">
                <div className={cn('flex items-center gap-2 text-xs uppercase tracking-wider font-semibold mb-2', Meta.color)}>
                  <Icon className="h-3.5 w-3.5" /> {Meta.label}
                  <span className="text-fg-dim normal-case tracking-normal font-normal">
                    · {formatEUR(items.reduce((s, i) => s + i.monthlyEstimate, 0))}/mois
                  </span>
                </div>
                <ul className="space-y-2">
                  {items.map((s) => (
                    <li key={s.key} className={cn('rounded-md border px-3 py-2', s.cuttable ? 'border-accent/30 bg-accent/5' : 'border-border')}>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="flex-1 truncate text-fg" title={s.label}>{s.label}</span>
                        {s.cuttable && <span className="text-[10px] uppercase tracking-wide text-accent border border-accent/40 rounded px-1.5">coupable</span>}
                        <span className="font-mono text-xs text-fg-bright whitespace-nowrap">~{formatEUR(s.monthlyEstimate)}/mois</span>
                      </div>
                      <div className="text-xs text-fg-muted mt-0.5">
                        {s.advice}
                        <span className="text-fg-dim"> — vu {s.occurrences}× sur {s.monthsSeen} mois, dernier le {formatDate(s.lastSeenDate)} ({s.sampleAmounts.map((a) => formatEUR(-a)).join(', ')})</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {cutResult.suggestions.length === 0 && (
            <p className="text-sm text-fg-dim italic">Rien à proposer — aucune dépense significative hors crédits/abonnements.</p>
          )}
        </div>
      )}
    </>
  );
}
