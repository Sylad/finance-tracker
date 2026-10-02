import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { PageHeader } from '@/components/page-header';
import { RotateCw } from 'lucide-react';
import { EmptyState, LoadingState } from '@/components/loading-state';
import { NEWS_QUERY_KEY, fetchNews } from '@/lib/news-data';
import {
  PLAN_QUERY_KEY,
  RECENT_DAYS,
  fetchPlan,
  formatDay,
  groupPlan,
  isEmpty,
  liveTasks,
  newsSlugByLot,
  progress,
  progressText,
  summary,
  type PlanLot,
  type PlanStatus,
} from '@/lib/plan';
import { cn } from '@/lib/utils';

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

// Grammaire de carte commune avec Nouveautés : surtitre « badge · date » → titre →
// barre « n/m étapes » → actions sur une ligne (empilées < 400 px). L'identifiant du
// lot n'est pas montré au visiteur (L50) : il reste l'ancre /plan#<id>.
function LotCard({ lot, newsSlug, target }: { lot: PlanLot; newsSlug?: string; target: boolean }) {
  const [open, setOpen] = useState(false);
  const p = progress(lot);
  const badge = STATUS_BADGE[lot.status];
  const date = dateLine(lot);
  const steps = liveTasks(lot).filter((t) => t.title);
  // Étapes sans titre public : comptées dans n/m (l'avancement réel), annoncées dans la liste.
  const untitled = liveTasks(lot).length - steps.length;
  const ready = p !== null && lot.status !== 'done' && p.done === p.total;
  const stepsId = `${lot.id}-etapes`;
  return (
    // tabIndex -1 : la carte visée par /plan#<id> reçoit le focus à l'arrivée (L50).
    // scroll-mt-20 : sous l'en-tête fixe du téléphone (56 px).
    <li
      id={lot.id}
      tabIndex={-1}
      data-target={target ? 'true' : undefined}
      className={cn('card p-5 scroll-mt-20 lg:scroll-mt-6 focus:outline-none', target && 'border-accent-bright ring-1 ring-accent-bright')}
    >
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted">
        <span className={badge.className}>{badge.label}</span>
        {date && (
          // Le point reste collé à la date (jamais orphelin à 320 px) ; la date ne se coupe pas.
          <span className="whitespace-nowrap">
            <span aria-hidden="true">· </span>
            <time dateTime={date.day}>{date.text}</time>
          </span>
        )}
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
            aria-valuetext={progressText(p, lot.status)}
          >
            <div className="h-full bg-accent" style={{ width: `${(100 * p.done) / p.total}%` }} />
          </div>
          <span className="text-xs text-fg-muted tabular-nums" aria-hidden="true">{p.done}/{p.total} étapes</span>
        </div>
      )}
      {ready && (
        // Dit aussi par aria-valuetext de la barre.
        <p className="mt-1 text-xs font-medium text-fg" aria-hidden="true">Prêt, en attente de livraison</p>
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
          {untitled > 0 && (
            <li className="text-fg-muted">
              + {untitled} {plural(untitled, 'étape non détaillée', 'étapes non détaillées')}
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

function Group({ id, title, hint, lots, empty, slugs, target, footer }: {
  id: string;
  title: string;
  hint: string;
  lots: PlanLot[];
  empty: string;
  slugs: Map<string, string>;
  target: string | null;
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
          {lots.map((l) => <LotCard key={l.id} lot={l} newsSlug={slugs.get(l.id)} target={target === l.id} />)}
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

  // Lien permanent /plan#<id> (L50) : la carte n'existe qu'une fois le plan chargé.
  // Défilement et focus une seule fois par arrivée (premier chargement, vrai changement
  // d'ancre) : un rechargement du plan en arrière-plan ne ramène pas la page ni ne vole
  // le focus. Seuls les identifiants de lots publiés sont visés.
  const [target, setTarget] = useState<string | null>(null);
  const revealedHash = useRef<string | null>(null);
  useEffect(() => {
    const lots = plan.data?.lots;
    if (!lots) return;
    const reveal = (force: boolean) => {
      const hash = window.location.hash;
      let id = '';
      try {
        id = decodeURIComponent(hash.slice(1));
      } catch {
        /* ancre mal encodée : aucune carte visée */
      }
      const el = lots.some((l) => l.id === id) ? document.getElementById(id) : null;
      setTarget(el ? id : null);
      if (el && (force || revealedHash.current !== hash)) {
        revealedHash.current = hash;
        el.scrollIntoView?.({ block: 'start' });
        el.focus({ preventScroll: true });
      }
    };
    reveal(false);
    const onHash = () => reveal(true);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [plan.data]);

  // « Réessayer » (L50) : le bouton disparaît pendant le chargement ; le focus ne doit
  // pas tomber sur BODY (WCAG 2.4.3). Nouvel échec → heure annoncée dans l'alerte et
  // focus sur le nouveau bouton ; succès → focus sur le résumé (ou le message d'état).
  const [retryFailedAt, setRetryFailedAt] = useState<string | null>(null);
  const [focusAfterRetry, setFocusAfterRetry] = useState<'retry' | 'result' | null>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const resultRef = useRef<HTMLParagraphElement>(null);
  const retry = async () => {
    const r = await plan.refetch();
    if (r.isError) {
      setRetryFailedAt(new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
      setFocusAfterRetry('retry');
    } else {
      setRetryFailedAt(null);
      setFocusAfterRetry('result');
    }
  };
  useEffect(() => {
    if (!focusAfterRetry) return;
    (focusAfterRetry === 'retry' ? retryButton.current : resultRef.current)?.focus();
    setFocusAfterRetry(null);
  }, [focusAfterRetry, plan.status, plan.isFetching]);

  let body: React.ReactNode;
  if (plan.isLoading) body = <LoadingState />;
  else if (plan.isError) {
    body = (
      <div role="alert" className="card border-negative/30 p-6 text-center">
        <div className="text-negative text-sm font-medium">Le plan n'a pas pu être chargé</div>
        <div className="text-fg-muted text-xs mt-1.5">Vérifiez la connexion, puis réessayez.</div>
        {retryFailedAt && <div className="text-fg text-xs mt-1.5">Nouvel essai à {retryFailedAt} : échec.</div>}
        <button
          ref={retryButton}
          type="button"
          onClick={() => void retry()}
          disabled={plan.isFetching}
          className="btn-secondary mt-4 inline-flex min-h-11"
        >
          <RotateCw className={plan.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden /> Réessayer
        </button>
      </div>
    );
  } else if (!plan.data) {
    body = (
      <p ref={resultRef} tabIndex={-1} className="card p-8 text-center text-fg-muted text-sm font-medium focus:outline-none">
        Aucun plan publié pour l'instant.
      </p>
    );
  } else {
    const g = groupPlan(plan.data.lots, new Date());
    const older = g.olderDone;
    body = isEmpty(g) ? (
      <div className="card p-8 text-center">
        <p ref={resultRef} tabIndex={-1} className="text-fg-muted text-sm font-medium focus:outline-none">Rien en préparation pour l'instant.</p>
        <p className="text-sm mt-1.5"><NewsLink>Voir les Nouveautés</NewsLink></p>
      </div>
    ) : (
      <>
        <p ref={resultRef} tabIndex={-1} className="card px-5 py-4 mb-8 text-fg focus:outline-none">
          <span className="stat-label text-fg-muted block mb-1">En ce moment</span>
          {summary(g)}
        </p>
        <Group id="plan-doing" title="En cours" hint="Le travail commencé, pas encore livré."
          lots={g.doing} empty="Rien en cours pour l'instant." slugs={slugs} target={target} />
        <Group id="plan-todo" title="Prévu" hint="La suite, dans l'ordre du plan."
          lots={g.todo} empty="Rien de prévu pour l'instant." slugs={slugs} target={target} />
        <Group id="plan-done" title="Récemment livré" hint={`Livré ces ${RECENT_DAYS} derniers jours, le plus récent en premier.`}
          lots={g.done} empty={`Rien de livré ces ${RECENT_DAYS} derniers jours.`} slugs={slugs} target={target}
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
