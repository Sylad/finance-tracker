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
  ChevronDown,
} from 'lucide-react';
import {
  useStatements,
  useScoreHistory,
  useBudget,
  useStatement,
  useSavingsAccounts,
  useLoans,
  useNetWorth,
  useAlerts,
  useYearlyOverview,
  useHealthDiagnostic,
} from '@/lib/queries';
import { PageHeader } from '@/components/page-header';
import { LoadingState, ErrorState } from '@/components/loading-state';
import { dashboardView } from '@/components/dashboard/dashboard-view';
import { ApiError } from '@/lib/api';
import { ScoreRing } from '@/components/score-ring';
import { formatEUR, formatMonth, formatMonthShort, cn } from '@/lib/utils';
import { StatCard } from '@/components/dashboard/stat-card';
import { BudgetSnapshot } from '@/components/dashboard/budget-snapshot';
import { ScoreTrendChart } from '@/components/dashboard/score-trend-chart';
import { BalanceTrendChart } from '@/components/dashboard/balance-trend-chart';
import { RecentStatements } from '@/components/dashboard/recent-statements';
import { YearlyCharts } from '@/components/dashboard/yearly-charts';
import { HealthTile } from '@/components/dashboard/health-tile';
import { MonthSummaryCard, HealthScoreCompact, PhoneMoreLinks } from '@/components/dashboard/phone-cards';

export function DashboardPage() {
  const stmts = useStatements();
  const history = useScoreHistory();
  const budget = useBudget();
  const savings = useSavingsAccounts();
  const loans = useLoans();
  const netWorth = useNetWorth();
  const alerts = useAlerts();
  const yearly = useYearlyOverview(12);
  const health = useHealthDiagnostic();

  const totalSavings = (savings.data ?? []).reduce((s, a) => s + a.currentBalance, 0);
  const activeLoans = (loans.data ?? []).filter((l) => l.isActive);
  const totalMonthlyLoans = activeLoans.reduce((s, l) => s + l.monthlyPayment, 0);

  const summaries = stmts.data ?? [];
  const current = summaries[0];
  const currentDetail = useStatement(current?.id);

  const view = dashboardView(stmts);
  if (view === 'loading') return <LoadingState />;

  if (view === 'offline') {
    return (
      <>
        <PageHeader title="Tableau de bord" />
        <ErrorState
          title="Hors ligne"
          message="Pas de connexion au serveur : les relevés se chargeront dès que le réseau revient. Tes données ne sont pas perdues."
          onRetry={() => { void stmts.refetch(); }}
        />
      </>
    );
  }

  if (view === 'error') {
    return (
      <>
        <PageHeader title="Tableau de bord" />
        <ErrorState
          title="Impossible de charger les relevés"
          message={`Le serveur a répondu par une erreur${stmts.error instanceof ApiError ? ` (HTTP ${stmts.error.status})` : ''}. Tes données ne sont pas perdues : réessaie dans un instant.`}
          onRetry={() => { void stmts.refetch(); }}
          retrying={stmts.isFetching}
        />
      </>
    );
  }

  if (view === 'empty') {
    return (
      <>
        <PageHeader title="Tableau de bord" subtitle="Aucun relevé pour l'instant. Commence par importer un PDF de relevé bancaire." />
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

  const comment = currentDetail.data?.healthScore.claudeComment;

  return (
    <>
      <PageHeader
        className="hidden md:flex"
        eyebrow={formatMonth(current.month, current.year)}
        title="Tableau de bord"
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
      {/* Téléphone (L21/t8) : mois + tendance sur une ligne, titre pour les lecteurs d'écran. */}
      <div className="md:hidden mb-4">
        <h1 className="sr-only">Tableau de bord</h1>
        <div className="flex items-center justify-between gap-3">
          <div className="stat-label text-accent-bright">{formatMonth(current.month, current.year)}</div>
          <span className={cn(trendBadge, 'tabular')}>{trendIcon} {trendLabel}</span>
        </div>
      </div>

      {netWorth.data && (
        <div className="card p-4 sm:p-6 mb-4 md:mb-6 bg-gradient-to-r from-surface to-surface-2/40 [container-type:inline-size]">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="min-w-0 max-w-full">
              <div className="stat-label">Patrimoine net</div>
              <div className="amount-fluid font-display font-bold tabular text-fg-bright mt-1">
                {formatEUR(netWorth.data.netWorth)}
              </div>
              <div className="hidden md:block text-xs text-fg-dim mt-1">
                {netWorthDetail(netWorth.data)}
              </div>
              <details className="md:hidden group mt-1">
                <summary className="flex items-center gap-1 min-h-11 cursor-pointer list-none text-xs font-medium text-fg-muted [&::-webkit-details-marker]:hidden">
                  <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" /> Détail
                </summary>
                <div className="text-xs text-fg-dim">{netWorthDetail(netWorth.data)}</div>
              </details>
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
        <div className="card p-4 mb-4 md:mb-6 border-l-4 border-l-warning">
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

      {/* Téléphone : Ce mois, santé compacte, points d'attention (L21/t8). */}
      <div className="md:hidden space-y-4 mb-4">
        <MonthSummaryCard
          credits={current.totalCredits}
          debits={current.totalDebits}
          closingBalance={current.closingBalance}
        />
        <HealthScoreCompact score={current.healthScore} comment={comment} />
        <HealthTile diagnostic={health.data} />
      </div>

      <section className="hidden md:grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <div className="card p-6 md:col-span-2 lg:col-span-1 lg:row-span-4 flex flex-col">
          <div className="stat-label flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" /> Santé financière
          </div>
          <div className="flex-1 flex items-center justify-center my-6">
            <ScoreRing score={current.healthScore} size={180} strokeWidth={14} />
          </div>
          {comment && (
            <blockquote className="text-sm text-fg-muted italic border-l-2 border-accent/40 pl-3 leading-relaxed">
              {comment}
            </blockquote>
          )}
        </div>
        <StatCard
          label="Entrées"
          value={formatEUR(current.totalCredits)}
          icon={<ArrowUpRight className="h-4 w-4 text-positive" />}
          tone="positive"
        />
        <StatCard
          label="Débits"
          value={formatEUR(current.totalDebits)}
          icon={<ArrowDownRight className="h-4 w-4 text-negative" />}
          tone="negative"
        />
        <StatCard
          label="Net du mois"
          value={formatEUR(net, true)}
          tone={net >= 0 ? 'positive' : 'negative'}
        />
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
        <HealthTile diagnostic={health.data} className="md:col-span-2" />
      </section>

      <section className="hidden md:grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <ScoreTrendChart series={scoreSeries} currentScore={current.healthScore} />
        <BalanceTrendChart series={balanceSeries} currentBalance={current.closingBalance} />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <RecentStatements summaries={summaries} />
        <div className="order-first md:order-none">
          <BudgetSnapshot
            budget={budget.data}
            transactions={currentDetail.data?.transactions}
            budgetQ={budget}
            txQ={currentDetail}
            onRetry={() => { void budget.refetch(); void currentDetail.refetch(); }}
          />
        </div>
        <div className="md:hidden">
          <PhoneMoreLinks />
        </div>
      </section>

      {yearly.data && yearly.data.monthly.length >= 2 && (
        <section className="hidden md:grid mt-6 grid-cols-1 lg:grid-cols-2 gap-4">
          <YearlyCharts data={yearly.data} />
        </section>
      )}
    </>
  );
}

function netWorthDetail(d: { closingBalance: number; totalSavings: number; estimatedDebt: number }) {
  return `${formatEUR(d.closingBalance)} compte courant + ${formatEUR(d.totalSavings)} épargne − ${formatEUR(d.estimatedDebt)} dettes estimées`;
}
