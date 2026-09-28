import { Link } from '@tanstack/react-router';
import { ArrowRight, ChevronDown, Sparkles } from 'lucide-react';
import { ScoreRing } from '@/components/score-ring';
import { cn, formatEUR } from '@/lib/utils';

/**
 * Cartes du tableau de bord TÉLÉPHONE (< md), maquette validée par Sylvain
 * le 28-09 (L21/t8). Affichées en md:hidden ; le bureau garde ses tuiles.
 */

export function MonthSummaryCard({
  credits,
  debits,
  closingBalance,
}: {
  credits: number;
  debits: number;
  closingBalance: number;
}) {
  const net = credits - debits;
  const rows: Array<{ label: string; value: string; tone?: 'positive' | 'negative' }> = [
    { label: 'Entrées', value: formatEUR(credits), tone: 'positive' },
    { label: 'Débits', value: formatEUR(debits), tone: 'negative' },
    { label: 'Net', value: formatEUR(net, true), tone: net >= 0 ? 'positive' : 'negative' },
    { label: 'Solde', value: formatEUR(closingBalance) },
  ];
  return (
    <section className="card p-4" aria-labelledby="month-summary-title">
      <h2 id="month-summary-title" className="stat-label mb-2">Ce mois</h2>
      <dl className="divide-y divide-border">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-3 py-1.5">
            <dt className="text-sm text-fg-muted">{r.label}</dt>
            <dd
              className={cn(
                'font-display tabular font-semibold text-lg text-right',
                r.tone === 'positive' && 'text-positive',
                r.tone === 'negative' && 'text-negative',
                !r.tone && 'text-fg-bright',
              )}
            >
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function HealthScoreCompact({ score, comment }: { score: number; comment?: string }) {
  return (
    <section className="card p-4" aria-labelledby="health-compact-title">
      <div className="flex items-center gap-4">
        <ScoreRing score={score} size={96} strokeWidth={9} />
        <div className="min-w-0">
          <h2 id="health-compact-title" className="stat-label flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" /> Santé financière
          </h2>
          <Link to="/health" className="mt-2 inline-flex items-center gap-1 text-sm text-accent-bright font-medium min-h-11">
            Voir le diagnostic <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
      {comment && (
        <details className="group mt-2">
          <summary className="flex items-center gap-1.5 min-h-11 cursor-pointer list-none text-sm font-medium text-fg-muted hover:text-fg [&::-webkit-details-marker]:hidden">
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /> Lire l'analyse
          </summary>
          <blockquote className="text-sm text-fg-muted italic border-l-2 border-accent/40 pl-3 leading-relaxed">
            {comment}
          </blockquote>
        </details>
      )}
    </section>
  );
}

const MORE_LINKS = [
  { to: '/health' as const, label: 'Évolution du score', hint: 'Santé financière' },
  { to: '/history' as const, label: 'Évolution du solde', hint: 'Historique des relevés' },
  { to: '/yearly' as const, label: 'Entrées / sorties sur 12 mois', hint: 'Bilan annuel' },
  { to: '/expenses' as const, label: 'Top 5 des postes de dépense', hint: 'Dépenses' },
];

export function PhoneMoreLinks() {
  return (
    <nav className="card p-2" aria-label="Plus de détails">
      <ul className="divide-y divide-border">
        {MORE_LINKS.map((l) => (
          <li key={l.to + l.label}>
            <Link to={l.to} className="flex items-center justify-between gap-3 px-2 min-h-12 py-2 rounded hover:bg-surface-2">
              <span>
                <span className="block text-sm font-medium text-fg-bright">{l.label}</span>
                <span className="block text-xs text-fg-dim">{l.hint}</span>
              </span>
              <ArrowRight className="h-4 w-4 text-fg-dim shrink-0" />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
