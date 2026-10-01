import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/loading-state';
import { NEWS_QUERY_KEY, fetchNews } from '@/lib/news-data';
import {
  PLAN_QUERY_KEY,
  RECENT_DAYS,
  fetchPlan,
  formatDay,
  groupPlan,
  isEmpty,
  newsSlugByLot,
  progress,
  summary,
  type PlanLot,
  type PlanStatus,
} from '@/lib/plan';

// Données publiques générées par `npm run plan` (frontend/scripts/plan-data.mjs)
// depuis docs/plan/raf.yaml : lots visibles, TITRES PUBLICS et états seulement.

const STATUS_BADGE: Record<PlanStatus, { label: string; className: string }> = {
  doing: { label: 'En cours', className: 'badge-info' },
  todo: { label: 'Prévu', className: 'badge-neutral' },
  done: { label: 'Livré', className: 'badge-positive' },
};

const ACTION = 'inline-flex items-center min-h-11 text-sm text-accent-bright hover:underline rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-bright';

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

function dateLine(lot: PlanLot): { day: string; text: string } | null {
  if (lot.status === 'done' && lot.finished) return { day: lot.finished, text: `Livré le ${formatDay(lot.finished)}` };
  if (lot.status === 'doing' && lot.started) return { day: lot.started, text: `Démarré le ${formatDay(lot.started)}` };
  return null;
}

// Grammaire de carte commune avec Nouveautés : surtitre « badge · date » + id
// à droite → titre → barre « n/m étapes » → actions sur une ligne (empilées < 400 px).
function LotCard({ lot, newsSlug }: { lot: PlanLot; newsSlug?: string }) {
  const [open, setOpen] = useState(false);
  const p = progress(lot);
  const badge = STATUS_BADGE[lot.status];
  const date = dateLine(lot);
  const steps = (lot.tasks ?? []).filter((t) => t.title);
  const stepsId = `${lot.id}-etapes`;
  return (
    <li id={lot.id} className="card p-5 scroll-mt-24">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted">
          <span className={badge.className}>{badge.label}</span>
          {date && (
            // Le point reste collé à la date : jamais orphelin en fin de ligne (320 px).
            <span>
              <span aria-hidden="true">· </span>
              <time dateTime={date.day}>{date.text}</time>
            </span>
          )}
        </div>
        <span className="text-xs text-fg-dim shrink-0 pt-0.5">{lot.id}</span>
      </div>
      <h3 className="font-display text-base font-bold text-fg-bright leading-snug [overflow-wrap:anywhere]">
        {lot.title}
      </h3>
      {p && (
        <div className="mt-3 flex items-center gap-3">
          <div
            className="h-1.5 flex-1 rounded-full bg-surface-3 overflow-hidden"
            role="progressbar"
            aria-label={`Avancement : ${lot.title}`}
            aria-valuemin={0}
            aria-valuemax={p.total}
            aria-valuenow={p.done}
            aria-valuetext={`${p.done} ${plural(p.done, 'étape faite', 'étapes faites')} sur ${p.total}`}
          >
            <div className="h-full bg-accent" style={{ width: `${(100 * p.done) / p.total}%` }} />
          </div>
          <span className="text-xs text-fg-muted tabular-nums" aria-hidden="true">{p.done}/{p.total} étapes</span>
        </div>
      )}
      {(steps.length > 0 || newsSlug) && (
        <div className="mt-2 flex flex-col items-start min-[400px]:flex-row min-[400px]:flex-wrap min-[400px]:gap-x-5">
          {steps.length > 0 && (
            <button type="button" className={ACTION} aria-expanded={open} aria-controls={stepsId} onClick={() => setOpen((o) => !o)}>
              {open ? 'Masquer les étapes' : 'Voir les étapes'}
              <span className="sr-only"> : {lot.title}</span>
            </button>
          )}
          {newsSlug && (
            <Link to="/nouveautes" hash={newsSlug} className={ACTION}>
              Voir la nouveauté<span className="sr-only"> : {lot.title}</span>
            </Link>
          )}
        </div>
      )}
      {open && (
        <ul id={stepsId} className="mt-1 space-y-1 text-sm text-fg">
          {steps.map((t, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden="true" className={t.status === 'done' ? 'text-positive' : 'text-fg-dim'}>
                {t.status === 'done' ? '✓' : '○'}
              </span>
              <span className="[overflow-wrap:anywhere]">
                {t.title}
                <span className="sr-only">{t.status === 'done' ? ' (faite)' : ' (à faire)'}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Group({ id, title, hint, lots, empty, slugs, footer }: {
  id: string;
  title: string;
  hint: string;
  lots: PlanLot[];
  empty: string;
  slugs: Map<string, string>;
  footer?: React.ReactNode;
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
          {lots.map((l) => <LotCard key={l.id} lot={l} newsSlug={slugs.get(l.id)} />)}
        </ul>
      )}
      {footer}
    </section>
  );
}

const NewsLink = ({ children }: { children: React.ReactNode }) => (
  <Link to="/nouveautes" className="text-accent-bright hover:underline">{children}</Link>
);

export function PlanPage() {
  const plan = useQuery({ queryKey: PLAN_QUERY_KEY, queryFn: fetchPlan, staleTime: 5 * 60_000 });
  const news = useQuery({ queryKey: NEWS_QUERY_KEY, queryFn: fetchNews, staleTime: 5 * 60_000 });
  const slugs = newsSlugByLot(news.data?.entries ?? []);

  // Lien permanent /plan#<id> : la carte n'existe qu'une fois le plan chargé.
  useEffect(() => {
    if (!plan.data) return;
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView?.({ block: 'start' });
  }, [plan.data]);

  let body: React.ReactNode;
  if (plan.isLoading) body = <LoadingState />;
  else if (plan.isError) {
    body = (
      <ErrorState
        title="Le plan n'a pas pu être chargé"
        message="Vérifiez la connexion, puis réessayez."
        onRetry={() => plan.refetch()}
        retrying={plan.isFetching}
      />
    );
  } else if (!plan.data) body = <EmptyState title="Aucun plan publié pour l'instant." />;
  else {
    const g = groupPlan(plan.data.lots, new Date());
    const older = g.olderDone;
    body = isEmpty(g) ? (
      <div className="card p-8 text-center">
        <p className="text-fg-muted text-sm font-medium">Rien en préparation pour l'instant.</p>
        <p className="text-sm mt-1.5"><NewsLink>Voir les Nouveautés</NewsLink></p>
      </div>
    ) : (
      <>
        <p className="card px-5 py-4 mb-8 text-fg">
          <span className="stat-label text-fg-muted block mb-1">En ce moment</span>
          {summary(g)}
        </p>
        <Group id="plan-doing" title="En cours" hint="Le travail commencé, pas encore livré."
          lots={g.doing} empty="Rien en cours pour l'instant." slugs={slugs} />
        <Group id="plan-todo" title="Prévu" hint="La suite, dans l'ordre du plan."
          lots={g.todo} empty="Rien de prévu pour l'instant." slugs={slugs} />
        <Group id="plan-done" title="Récemment livré" hint={`Livré ces ${RECENT_DAYS} derniers jours, le plus récent en premier.`}
          lots={g.done} empty={`Rien de livré ces ${RECENT_DAYS} derniers jours.`} slugs={slugs}
          footer={older > 0 && (
            <p className="text-sm text-fg-muted mt-3">
              {older} {plural(older, 'évolution livrée plus ancienne', 'évolutions livrées plus anciennes')} : <NewsLink>voir les Nouveautés</NewsLink>.
            </p>
          )} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Plan de travail"
        title="Ce qui se prépare"
        subtitle="Les évolutions visibles de l'application : ce qui est en cours, ce qui est prévu et ce qui vient d'être livré."
      />
      {body}
    </>
  );
}
