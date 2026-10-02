import { Fragment, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Link2 } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { EmptyState, LoadingState } from '@/components/loading-state';
import { NEWS_BASE as BASE, NEWS_QUERY_KEY, fetchNews, formatNewsDay } from '@/lib/news-data';
import {
  NEWS_SEEN_EVENT,
  browserStorage,
  isUnseen,
  markAllSeen,
  readSeen,
  seenSeparatorIndex,
  seenSeparatorLabel,
  sinceLabel,
} from '@/lib/news-badge';
import { entryForFragment, permalink } from '@/lib/news-anchor';
import { PLAN_QUERY_KEY, fetchPlan } from '@/lib/plan';
import { cn } from '@/lib/utils';

type CopyState = 'idle' | 'ok' | 'ko';
const COPY_LABELS: Record<CopyState, string> = { idle: 'Copier le lien', ok: 'Lien copié', ko: 'Copie impossible' };

export function NewsPage() {
  const news = useQuery({ queryKey: NEWS_QUERY_KEY, queryFn: fetchNews, staleTime: 5 * 60_000 });
  // Lots publiés dans le Plan de travail (L48) : lien discret « Dans le plan de travail ».
  const plan = useQuery({ queryKey: PLAN_QUERY_KEY, queryFn: fetchPlan, staleTime: 5 * 60_000 });
  const inPlan = new Set((plan.data?.lots ?? []).map((l) => l.id));
  const entries = news.data?.entries ?? [];

  // L47 — dernière visite : lue UNE fois à l'arrivée (avant que la visite ne soit
  // mémorisée), pour marquer « Nouveau » et poser le séparateur. Dès que le journal est
  // là, tout est marqué vu et la pastille de la navigation s'éteint ; les marques
  // restent affichées pendant cette visite.
  const [previousVisit] = useState(() => readSeen(browserStorage()));
  const loaded = news.data?.entries;
  useEffect(() => {
    if (!loaded?.length) return;
    markAllSeen(browserStorage(), loaded);
    window.dispatchEvent(new Event(NEWS_SEEN_EVENT));
  }, [loaded]);
  const fresh = entries.map((e) => isUnseen(e, previousVisit));
  const freshCount = fresh.filter(Boolean).length;
  const separatorAt = previousVisit ? seenSeparatorIndex(fresh) : -1;

  // L47 — lien permanent /nouveautes#<slug> : le journal arrive après la page, le
  // défilement natif vers l'ancre ne trouve rien ; la page vise l'entrée ensuite, une
  // fois par arrivée (un rechargement du journal en arrière-plan ne refait ni
  // défilement ni focus).
  const [target, setTarget] = useState<string | null>(null);
  const revealedHash = useRef<string | null>(null);
  useEffect(() => {
    if (!loaded?.length) return;
    const hash = window.location.hash;
    const slug = entryForFragment(hash, loaded);
    setTarget(slug);
    const el = slug ? document.getElementById(slug) : null;
    if (el && revealedHash.current !== hash) {
      revealedHash.current = hash;
      el.scrollIntoView?.({ block: 'start' });
      el.focus({ preventScroll: true });
    }
    const onHash = () => {
      revealedHash.current = window.location.hash;
      setTarget(entryForFragment(window.location.hash, loaded));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [loaded]);

  // « Copier le lien » : copie seulement — l'adresse ne change pas, la page ne défile
  // pas. Retour dans le libellé du bouton (largeur réservée) et annonce masquée ; une
  // réussite s'efface après 4 s, un échec laisse l'adresse affichée sous le titre.
  const [copy, setCopy] = useState<Record<string, CopyState>>({});
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const copyLink = async (slug: string) => {
    let st: CopyState;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('presse-papiers indisponible');
      await navigator.clipboard.writeText(permalink(window.location.origin, slug));
      st = 'ok';
    } catch {
      st = 'ko';
    }
    setCopy((c) => ({ ...c, [slug]: st }));
    if (st === 'ko') return;
    timers.current.push(
      setTimeout(() => setCopy((c) => {
        if (c[slug] !== 'ok') return c;
        const { [slug]: _done, ...rest } = c;
        return rest;
      }), 4000),
    );
  };

  return (
    <>
      <PageHeader
        eyebrow="Nouveautés"
        title="Ce qui a changé"
        subtitle="Le journal des évolutions visibles de l'application, la plus récente en premier."
      />
      <p
        data-testid="nouveautes-depuis"
        role="status"
        className="-mt-4 mb-6 text-sm font-semibold text-fg-bright empty:hidden"
      >
        {sinceLabel(freshCount)}
      </p>
      {news.isLoading ? (
        <LoadingState />
      ) : entries.length === 0 ? (
        <EmptyState title="Aucune nouveauté publiée pour l'instant." />
      ) : (
        <div className="space-y-6">
          {entries.map((e, index) => {
            const state = copy[e.slug] ?? 'idle';
            const url = permalink(window.location.origin, e.slug);
            return (
              <Fragment key={e.slug}>
                {index === separatorAt && previousVisit && (
                  // Repère visuel ; la ligne « N nouveautés depuis… » le dit aux lecteurs d'écran.
                  <div
                    data-testid="nouveautes-deja-vu"
                    aria-hidden="true"
                    className="flex items-center gap-3 text-xs text-fg-muted text-center before:h-px before:flex-1 before:bg-border-strong after:h-px after:flex-1 after:bg-border-strong"
                  >
                    {seenSeparatorLabel(previousVisit)}
                  </div>
                )}
                <article
                  id={e.slug}
                  tabIndex={-1}
                  data-target={target === e.slug ? 'true' : undefined}
                  aria-labelledby={`${e.slug}-titre`}
                  className={cn(
                    // scroll-mt-20 : sous l'en-tête fixe du téléphone (56 px) ; au bureau, rien de fixe.
                    'card p-6 scroll-mt-20 lg:scroll-mt-6 focus:outline-none',
                    target === e.slug && 'border-accent-bright ring-1 ring-accent-bright',
                  )}
                >
                  {/* La ligne passe à la ligne ENTRE la date, « Nouveau » et le bouton, jamais dans la date. */}
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-1">
                    <div className="stat-label text-fg-dim flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <time dateTime={e.date} className="whitespace-nowrap">{formatNewsDay(e.date)}</time>
                      {fresh[index] && (
                        <span className="whitespace-nowrap rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold tracking-[0.08em] text-bg">
                          Nouveau
                        </span>
                      )}
                    </div>
                    {/* Lien permanent visible sans survol : 44 px au toucher, 24 px au bureau
                        (marges négatives : la ligne de la date ne grandit pas). Les trois
                        libellés partagent la même case de grille : rien ne bouge au retour. */}
                    <button
                      type="button"
                      onClick={() => void copyLink(e.slug)}
                      className="-my-3 lg:-my-0.5 [@media(pointer:coarse)]:-my-3 inline-flex min-h-11 lg:min-h-6 [@media(pointer:coarse)]:min-h-11 shrink-0 items-center gap-1.5 rounded-sm px-1 -mr-1 text-xs font-medium text-accent-bright [@media(hover:hover)]:hover:underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-bright"
                    >
                      <Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span aria-hidden="true" className="grid text-left">
                        {(Object.keys(COPY_LABELS) as CopyState[]).map((k) => (
                          <span
                            key={k}
                            data-label
                            className={cn('col-start-1 row-start-1 whitespace-nowrap', state !== k && 'invisible')}
                          >
                            {COPY_LABELS[k]}
                          </span>
                        ))}
                      </span>
                      <span className="sr-only">Copier le lien : {e.title}</span>
                    </button>
                  </div>
                  <h2
                    id={`${e.slug}-titre`}
                    className="font-display text-xl font-bold text-fg-bright mb-3 [overflow-wrap:anywhere]"
                  >
                    {e.title}
                  </h2>
                  {state === 'ko' && (
                    <p data-testid="nouveautes-adresse" className="-mt-1 mb-3 text-sm text-fg [overflow-wrap:anywhere]">
                      Adresse de cette nouveauté : <span className="select-all text-accent-bright">{url}</span>
                    </p>
                  )}
                  <p role="status" className="sr-only">
                    {state === 'ok'
                      ? 'Lien copié dans le presse-papiers'
                      : state === 'ko'
                        ? `Copie impossible. Adresse de cette nouveauté : ${url}`
                        : ''}
                  </p>
                  {/* HTML produit par cadence depuis le Markdown du dépôt, texte échappé à la génération. */}
                  <div
                    className="text-fg leading-relaxed space-y-3 [overflow-wrap:anywhere] [&_a]:text-accent-bright [&_a:hover]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_code]:text-xs [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:rounded"
                    dangerouslySetInnerHTML={{ __html: e.html }}
                  />
                  {e.lots.filter((id) => inPlan.has(id)).map((id) => (
                    <Link
                      key={id}
                      to="/plan"
                      hash={id}
                      className="mt-3 inline-flex items-center min-h-11 text-sm text-fg-muted hover:text-accent-bright hover:underline"
                    >
                      Dans le plan de travail<span className="sr-only"> : {e.title}</span>
                    </Link>
                  ))}
                  {e.captures.map((c) => (
                    <a key={c} href={`${BASE}/${c}`} target="_blank" rel="noopener" className="block mt-4">
                      <img
                        src={`${BASE}/${c}`}
                        alt={`Capture : ${e.title}`}
                        loading="lazy"
                        className="w-full rounded-md border border-border"
                      />
                    </a>
                  ))}
                </article>
              </Fragment>
            );
          })}
        </div>
      )}
    </>
  );
}
