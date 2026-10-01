import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { PageHeader } from '@/components/page-header';
import { EmptyState, LoadingState } from '@/components/loading-state';
import { NEWS_QUERY_KEY, fetchNews } from '@/lib/news-data';
import {
  RECENT_DAYS,
  ageLabel,
  formatDay,
  groupPlan,
  newsSlugByLot,
  progress,
  summary,
  type PlanData,
  type PlanLot,
  type PlanStatus,
} from '@/lib/plan';

// Données publiques générées par `npm run plan` depuis docs/plan/raf.yaml
// (lots visibles seulement, titres et états — jamais les notes), servies en statique.
async function fetchPlan(): Promise<PlanData | null> {
  const res = await fetch('/plan-data/plan.json', { cache: 'no-cache' });
  if (!res.ok) return null;
  return res.json();
}

const STATUS_BADGE: Record<PlanStatus, { label: string; className: string }> = {
  doing: { label: 'En cours', className: 'badge-info' },
  todo: { label: 'Prévu', className: 'badge-neutral' },
  done: { label: 'Livré', className: 'badge-positive' },
};

function LotCard({ lot, today, newsSlug }: { lot: PlanLot; today: Date; newsSlug?: string }) {
  const p = progress(lot);
  const badge = STATUS_BADGE[lot.status];
  return (
    <li className="card p-5">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className={badge.className}>{badge.label}</span>
        <span className="text-xs text-fg-dim">{lot.id}</span>
      </div>
      <h3 className="font-display text-base font-bold text-fg-bright leading-snug [overflow-wrap:anywhere]">
        {lot.title}
      </h3>
      <div className="mt-2 text-sm text-fg-muted space-y-0.5">
        {lot.status === 'done' && lot.finished ? (
          <p>
            Livré le <time dateTime={lot.finished}>{formatDay(lot.finished)}</time> ({ageLabel(lot.finished, today)})
            {lot.started && lot.started !== lot.finished && (
              <>, démarré le <time dateTime={lot.started}>{formatDay(lot.started)}</time></>
            )}
          </p>
        ) : lot.started ? (
          <p>
            Démarré le <time dateTime={lot.started}>{formatDay(lot.started)}</time> ({ageLabel(lot.started, today)})
          </p>
        ) : null}
      </div>
      {p && (
        <div className="mt-3">
          <div className="flex items-center gap-3">
            <div
              className="h-1.5 flex-1 rounded-full bg-surface-3 overflow-hidden"
              role="progressbar"
              aria-label="Avancement des sous-tâches"
              aria-valuemin={0}
              aria-valuemax={p.total}
              aria-valuenow={p.done}
            >
              <div className="h-full bg-accent" style={{ width: `${(100 * p.done) / p.total}%` }} />
            </div>
            <span className="text-xs text-fg-muted tabular-nums">{p.done}/{p.total} sous-tâches</span>
          </div>
          <details className="mt-2 group">
            <summary className="cursor-pointer text-sm text-accent-bright hover:underline rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-bright">
              Voir les sous-tâches
            </summary>
            <ul className="mt-2 space-y-1 text-sm text-fg">
              {lot.tasks!.map((t, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden="true" className={t.status === 'done' ? 'text-positive' : 'text-fg-dim'}>
                    {t.status === 'done' ? '✓' : '○'}
                  </span>
                  <span className="[overflow-wrap:anywhere]">
                    {t.title}
                    <span className="sr-only">{t.status === 'done' ? ' (fait)' : ' (à faire)'}</span>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
      {newsSlug && (
        <Link
          to="/nouveautes"
          hash={newsSlug}
          className="mt-3 inline-block text-sm text-accent-bright hover:underline"
        >
          Voir la nouveauté
        </Link>
      )}
    </li>
  );
}

function Group({
  id,
  title,
  hint,
  lots,
  empty,
  today,
  slugs,
  footer,
}: {
  id: string;
  title: string;
  hint: string;
  lots: PlanLot[];
  empty: string;
  today: Date;
  slugs: Map<string, string>;
  footer?: string;
}) {
  return (
    <section aria-labelledby={id} className="mb-10">
      <h2 id={id} className="font-display text-xl font-bold text-fg-bright">
        {title} <span className="text-fg-muted font-medium">({lots.length})</span>
      </h2>
      <p className="text-sm text-fg-muted mt-1 mb-4">{hint}</p>
      {lots.length === 0 ? (
        <EmptyState title={empty} />
      ) : (
        <ul className="space-y-3">
          {lots.map((l) => (
            <LotCard key={l.id} lot={l} today={today} newsSlug={slugs.get(l.id)} />
          ))}
        </ul>
      )}
      {footer && <p className="text-sm text-fg-muted mt-3">{footer}</p>}
    </section>
  );
}

export function PlanPage() {
  const plan = useQuery({ queryKey: ['plan'], queryFn: fetchPlan, staleTime: 5 * 60_000 });
  const news = useQuery({ queryKey: NEWS_QUERY_KEY, queryFn: fetchNews, staleTime: 5 * 60_000 });
  const today = new Date();
  const slugs = newsSlugByLot(news.data?.entries ?? []);

  return (
    <>
      <PageHeader
        eyebrow="Plan de travail"
        title="Ce qui se prépare"
        subtitle="Les évolutions visibles de l'application : ce qui est en cours, ce qui est prévu et ce qui vient d'être livré."
      />
      {plan.isLoading ? (
        <LoadingState />
      ) : !plan.data ? (
        <EmptyState title="Aucun plan publié pour l'instant." />
      ) : (
        (() => {
          const g = groupPlan(plan.data.lots, today);
          const older = g.olderDone;
          return (
            <>
              <p className="card px-5 py-4 mb-8 text-fg">
                <span className="stat-label text-fg-muted block mb-1">En ce moment</span>
                {summary(g)}
              </p>
              <Group id="plan-doing" title="En cours" hint="Le travail commencé, pas encore livré."
                lots={g.doing} empty="Rien en cours pour l'instant." today={today} slugs={slugs} />
              <Group id="plan-todo" title="Prévu" hint="La suite, dans l'ordre du plan."
                lots={g.todo} empty="Rien de prévu pour l'instant." today={today} slugs={slugs} />
              <Group id="plan-done" title="Récemment livré" hint={`Livré ces ${RECENT_DAYS} derniers jours, le plus récent en premier.`}
                lots={g.done} empty={`Rien de livré ces ${RECENT_DAYS} derniers jours.`} today={today} slugs={slugs}
                footer={older > 0 ? `${older} lot${older > 1 ? 's' : ''} livré${older > 1 ? 's' : ''} plus ancien${older > 1 ? 's' : ''} : voir les Nouveautés.` : undefined} />
            </>
          );
        })()
      )}
    </>
  );
}
