import { Link } from '@tanstack/react-router';
import {
  ArrowDownRight,
  ArrowUpRight,
  Wallet,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Minus,
  Sparkles,
  PiggyBank,
  CreditCard,
} from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, AreaChart, Area, BarChart, Bar } from 'recharts';
import { useStatements, useScoreHistory, useBudget, useStatement, useClaudeUsage, useSavingsAccounts, useLoans, useNetWorth, useAlerts, useYearlyOverview } from '@/lib/queries';
import { PageHeader } from '@/components/page-header';
import { LoadingState } from '@/components/loading-state';
import { ScoreRing, ScoreBadge } from '@/components/score-ring';
import { CATEGORY_LABELS, type TransactionCategory } from '@/types/api';
import { formatEUR, formatMonth, formatMonthShort, cn, chartTooltipProps } from '@/lib/utils';

export function DashboardPage() {
  const stmts = useStatements();
  const history = useScoreHistory();
  const budget = useBudget();
  const claude = useClaudeUsage();
  const savings = useSavingsAccounts();
  const loans = useLoans();
  const netWorth = useNetWorth();
  const alerts = useAlerts();
  const yearly = useYearlyOverview(12);

  const totalSavings = (savings.data ?? []).reduce((s, a) => s + a.currentBalance, 0);
  const activeLoans = (loans.data ?? []).filter((l) => l.isActive);
  const totalMonthlyLoans = activeLoans.reduce((s, l) => s + l.monthlyPayment, 0);

  const summaries = stmts.data ?? [];
  const current = summaries[0];
  const currentDetail = useStatement(current?.id);

  if (stmts.isLoading) return <LoadingState />;

  if (!summaries.length) {
    return (
      <>
        <PageHeader title="Dashboard" subtitle="Aucun relevé pour l'instant. Commence par importer un PDF de relevé bancaire." />
        <div className="card p-12 text-center">
          <Wallet className="h-10 w-10 text-fg-dim mx-auto mb-4" />
          <h3 className="font-display text-lg font-semibold text-fg-bright mb-2">
            Commençons par un premier relevé
          </h3>
          <p className="text-sm text-fg-muted mb-6 max-w-md mx-auto">
            Claude analyse ton PDF, classe les transactions et génère ton score de santé financière.
          </p>
          <Link to="/upload" className="btn-primary inline-flex">
            <ArrowRight className="h-4 w-4" /> Importer mon premier relevé
          </Link>
        </div>
      </>
    );
  }

  const trend = current.trend;
  const trendIcon = trend === 'improving' ? <TrendingUp className="h-3.5 w-3.5" />
    : trend === 'declining' ? <TrendingDown className="h-3.5 w-3.5" />
    : <Minus className="h-3.5 w-3.5" />;
  const trendLabel = trend === 'improving' ? 'En amélioration'
    : trend === 'declining' ? 'En baisse'
    : trend === 'stable' ? 'Stable'
    : 'Données limitées';
  const trendBadge = trend === 'improving' ? 'badge-positive'
    : trend === 'declining' ? 'badge-negative'
    : 'badge-neutral';

  const scoreSeries = (history.data ?? []).map((e) => ({
    label: formatMonthShort(e.month, e.year),
    score: e.score,
  }));
  const balanceSeries = [...summaries].reverse().map((e) => ({
    label: formatMonthShort(e.month, e.year),
    balance: Math.round(e.closingBalance),
  }));

  const net = current.totalCredits - current.totalDebits;

  return (
    <>
      <PageHeader
        eyebrow={formatMonth(current.month, current.year)}
        title="Dashboard"
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            Vue d'ensemble basée sur {summaries.length} relevé{summaries.length > 1 ? 's' : ''} ·
            <span className={cn(trendBadge, 'tabular')}>{trendIcon} {trendLabel}</span>
          </span>
        }
        actions={
          <Link to="/upload" className="btn-primary">
            <ArrowRight className="h-4 w-4" /> Nouveau relevé
          </Link>
        }
      />

      {netWorth.data && (
        <div className="card p-6 mb-6 bg-gradient-to-r from-surface to-surface-2/40">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="stat-label">Patrimoine net</div>
              <div className="font-display text-display-lg font-bold tabular text-fg-bright mt-1">
                {formatEUR(netWorth.data.netWorth)}
              </div>
              <div className="text-xs text-fg-dim mt-1">
                {formatEUR(netWorth.data.closingBalance)} compte courant + {formatEUR(netWorth.data.totalSavings)} épargne − {formatEUR(netWorth.data.estimatedDebt)} dettes estimées
              </div>
            </div>
            {netWorth.data.ignoredLoanIds.length > 0 && (
              <div className="text-xs text-warning max-w-xs">
                ⚠ {netWorth.data.ignoredLoanIds.length} crédit(s) ignoré(s) (date de fin manquante)
              </div>
            )}
          </div>
        </div>
      )}

      {(alerts.data?.length ?? 0) > 0 && (
        <div className="card p-4 mb-6 border-l-4 border-l-warning">
          <div className="font-display font-semibold text-fg-bright mb-2">Alertes ({alerts.data!.length})</div>
          <div className="space-y-1.5">
            {alerts.data!.map((a, i) => (
              <div key={i} className={cn(
                'text-sm flex items-center gap-2',
                a.severity === 'critical' && 'text-negative',
                a.severity === 'warning' && 'text-warning',
                a.severity === 'info' && 'text-fg-muted',
              )}>
                <span>{a.severity === 'critical' ? '🔴' : a.severity === 'warning' ? '🟠' : 'ℹ️'}</span>
                {a.link ? <Link to={a.link} className="hover:underline">{a.message}</Link> : <span>{a.message}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Hero score card */}
        <div className="card p-6 lg:row-span-2 flex flex-col">
          <div className="stat-label flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" /> Santé financière
          </div>
          <div className="flex-1 flex items-center justify-center my-6">
            <ScoreRing score={current.healthScore} size={180} strokeWidth={14} />
          </div>
          {currentDetail.data?.healthScore.claudeComment && (
            <blockquote className="text-sm text-fg-muted italic border-l-2 border-accent/40 pl-3 leading-relaxed">
              {currentDetail.data.healthScore.claudeComment}
            </blockquote>
          )}
        </div>

        {/* Income */}
        <StatCard
          label="Entrées"
          value={formatEUR(current.totalCredits)}
          icon={<ArrowUpRight className="h-4 w-4 text-positive" />}
          tone="positive"
        />
        {/* Spend */}
        <StatCard
          label="Débits"
          value={formatEUR(current.totalDebits)}
          icon={<ArrowDownRight className="h-4 w-4 text-negative" />}
          tone="negative"
        />
        {/* Net */}
        <StatCard
          label="Net du mois"
          value={formatEUR(net, true)}
          tone={net >= 0 ? 'positive' : 'negative'}
        />
        {/* Closing balance */}
        <StatCard
          label="Solde de clôture"
          value={formatEUR(current.closingBalance)}
        />
        <StatCard
          label="Patrimoine épargne"
          value={formatEUR(totalSavings)}
          icon={<PiggyBank className="h-4 w-4 text-accent" />}
          tone="positive"
        />
        <StatCard
          label="Charge crédits"
          value={`${formatEUR(totalMonthlyLoans)} / mois`}
          icon={<CreditCard className="h-4 w-4 text-warning" />}
          tone="negative"
        />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="stat-label">Évolution du score</div>
              <div className="text-fg-bright font-display text-xl font-semibold mt-1">
                {scoreSeries.length} mois
              </div>
            </div>
            <ScoreBadge score={current.healthScore} />
          </div>
          {scoreSeries.length > 1 ? (
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={scoreSeries} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
                  <defs>
                    <linearGradient id="score-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(160 84% 50%)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="hsl(160 84% 50%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="label" tick={{ fill: 'hsl(var(--fg-dim))', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fill: 'hsl(var(--fg-dim))', fontSize: 11 }} axisLine={false} tickLine={false} width={30} />
                  <Tooltip {...chartTooltipProps} />
                  <Area type="monotone" dataKey="score" stroke="hsl(160 84% 50%)" strokeWidth={2} fill="url(#score-grad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-fg-dim italic py-12 text-center">Importe au moins 2 relevés pour voir l'évolution.</p>
          )}
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="stat-label">Évolution du solde</div>
              <div className="text-fg-bright font-display text-xl font-semibold mt-1 tabular">
                {formatEUR(current.closingBalance)}
              </div>
            </div>
          </div>
          {balanceSeries.length > 1 ? (
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={balanceSeries} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
                  <XAxis dataKey="label" tick={{ fill: 'hsl(var(--fg-dim))', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'hsl(var(--fg-dim))', fontSize: 11 }} axisLine={false} tickLine={false} width={50} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    {...chartTooltipProps}
                    formatter={(v: number) => [formatEUR(v), 'Solde']}
                  />
                  <Line type="monotone" dataKey="balance" stroke="hsl(217 91% 60%)" strokeWidth={2} dot={{ r: 3, fill: 'hsl(217 91% 60%)' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-fg-dim italic py-12 text-center">Importe au moins 2 relevés pour voir l'évolution.</p>
          )}
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent statements */}
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div className="stat-label">Relevés récents</div>
            <Link to="/history" className="text-xs text-accent-bright hover:text-accent flex items-center gap-1 font-medium">
              Voir tout <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="space-y-1">
            {summaries.slice(0, 5).map((s) => (
              <Link
                key={s.id}
                to="/history/$id"
                params={{ id: s.id }}
                className="flex items-center justify-between px-3 py-2.5 rounded hover:bg-surface-2 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-1 h-9 rounded-full bg-accent-dim group-hover:bg-accent transition-colors" />
                  <div>
                    <div className="text-sm font-medium text-fg-bright">
                      {formatMonth(s.month, s.year)}
                    </div>
                    <div className="text-xs text-fg-dim">
                      {s.transactionCount} transactions · {s.bankName}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right tabular">
                    <div className="text-sm text-fg">{formatEUR(s.closingBalance)}</div>
                    <div className="text-xs text-fg-dim">solde</div>
                  </div>
                  <ScoreBadge score={s.healthScore} />
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Budget snapshot */}
        <BudgetSnapshot
          budget={budget.data}
          transactions={currentDetail.data?.transactions}
        />
      </section>

      {claude.data && (
        <section className="mt-6">
          <ClaudeUsageCard usage={claude.data} />
        </section>
      )}

      {yearly.data && yearly.data.monthly.length >= 2 && (
        <section className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card p-5">
            <div className="stat-label mb-3">Entrées / sorties (12 mois glissants)</div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={yearly.data.monthly}>
                  <XAxis
                    dataKey="month"
                    tick={{ fill: 'hsl(var(--fg-dim))', fontSize: 10 }}
                    tickFormatter={(m: string) => {
                      const [y, mm] = m.split('-');
                      return formatMonthShort(Number(mm), Number(y));
                    }}
                  />
                  <YAxis tick={{ fill: 'hsl(var(--fg-dim))', fontSize: 10 }} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                  <Tooltip
                    {...chartTooltipProps}
                    labelFormatter={(m: string) => {
                      const [y, mm] = m.split('-');
                      return formatMonthShort(Number(mm), Number(y));
                    }}
                    formatter={(v: number, name: string) => [formatEUR(v), name]}
                  />
                  <Bar dataKey="credits" name="Entrées" fill="hsl(160 84% 50%)" />
                  <Bar dataKey="debits" name="Sorties" fill="hsl(0 70% 55%)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="card p-5">
            <div className="stat-label mb-3">Top 5 postes de dépense (12 mois)</div>
            <div className="space-y-2">
              {yearly.data.topCategories.map((c) => (
                <div key={c.category} className="flex items-center justify-between text-sm">
                  <span className="text-fg-muted">{CATEGORY_LABELS[c.category as TransactionCategory] ?? c.category}</span>
                  <span className="font-display tabular text-fg-bright">{formatEUR(c.total)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}

function StatCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  tone?: 'positive' | 'negative' | 'neutral';
}) {
  return (
    <div className="card p-5">
      <div className="stat-label flex items-center gap-1.5">
        {icon} {label}
      </div>
      <div
        className={cn(
          'mt-2 font-display tabular font-semibold tracking-tight',
          tone === 'positive' && 'text-positive',
          tone === 'negative' && 'text-negative',
          !tone && 'text-fg-bright',
        )}
        style={{ fontSize: 26 }}
      >
        {value}
      </div>
    </div>
  );
}

function BudgetSnapshot({
  budget,
  transactions,
}: {
  budget: Record<string, number | undefined> | undefined;
  transactions: { category: TransactionCategory; amount: number }[] | undefined;
}) {
  const items = budget && transactions ? buildItems(budget, transactions) : [];

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="stat-label">Budgets ce mois</div>
        <Link to="/budget" className="text-xs text-accent-bright hover:text-accent flex items-center gap-1 font-medium">
          Configurer <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-fg-dim italic">
          Aucun budget configuré.
        </p>
      ) : (
        <div className="space-y-3">
          {items.slice(0, 5).map((b) => (
            <div key={b.category}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-fg-muted font-medium">{b.label}</span>
                <span className={cn('tabular', b.over ? 'text-negative font-semibold' : 'text-fg-dim')}>
                  {Math.round(b.spent)} / {b.limit}€
                </span>
              </div>
              <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    b.over ? 'bg-negative' : b.pct >= 80 ? 'bg-warning' : 'bg-positive',
                  )}
                  style={{ width: `${Math.min(100, b.pct)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function buildItems(
  budget: Record<string, number | undefined>,
  transactions: { category: TransactionCategory; amount: number }[],
) {
  const spending = new Map<string, number>();
  for (const t of transactions) {
    if (t.amount < 0) spending.set(t.category, (spending.get(t.category) ?? 0) + Math.abs(t.amount));
  }
  return Object.entries(budget)
    .filter(([, l]) => typeof l === 'number' && l > 0)
    .map(([cat, limit]) => {
      const lim = limit as number;
      const spent = Math.round((spending.get(cat) ?? 0) * 100) / 100;
      const pct = Math.round((spent / lim) * 100);
      return {
        category: cat,
        label: CATEGORY_LABELS[cat as TransactionCategory] ?? cat,
        spent, limit: lim, pct,
        over: spent > lim,
      };
    })
    .sort((a, b) => b.pct - a.pct);
}

function ClaudeUsageCard({ usage }: { usage: import('@/types/api').ClaudeUsage }) {
  const remainingPct = usage.remainingPercent ?? null;
  const tone = remainingPct == null ? 'neutral'
    : remainingPct > 50 ? 'positive'
    : remainingPct > 20 ? 'warning'
    : 'negative';
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="stat-label flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" /> Budget Claude · {usage.calls} appels ce mois
          </div>
          <div className="mt-2 flex items-baseline gap-3">
            <div className="font-display text-display-md font-bold tabular text-fg-bright">
              {usage.estimatedCostEur.toFixed(2)}€
            </div>
            <div className="text-fg-dim text-sm tabular">/ {usage.budgetEur}€</div>
          </div>
        </div>
        {usage.hasBalance && usage.estimatedRemainingEur != null && (
          <div className="text-right">
            <div className="stat-label">Solde restant</div>
            <div className={cn(
              'font-display text-xl font-semibold tabular mt-1',
              tone === 'positive' && 'text-positive',
              tone === 'warning' && 'text-warning',
              tone === 'negative' && 'text-negative',
              tone === 'neutral' && 'text-fg-bright',
            )}>
              {usage.estimatedRemainingEur.toFixed(2)}€
            </div>
            <div className="text-xs text-fg-dim tabular">{remainingPct}% du crédit</div>
          </div>
        )}
      </div>
      <div className="mt-4 h-1.5 bg-surface-3 rounded-full overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            usage.percent >= 90 ? 'bg-negative' : usage.percent >= 70 ? 'bg-warning' : 'bg-accent',
          )}
          style={{ width: `${Math.min(100, usage.percent)}%` }}
        />
      </div>
    </div>
  );
}
