import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/page-header';
import { EmptyState, LoadingState } from '@/components/loading-state';
import { NEWS_BASE as BASE, NEWS_QUERY_KEY, fetchNews } from '@/lib/news-data';

const formatDate = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

export function NewsPage() {
  const news = useQuery({ queryKey: NEWS_QUERY_KEY, queryFn: fetchNews, staleTime: 5 * 60_000 });

  return (
    <>
      <PageHeader
        eyebrow="Nouveautés"
        title="Ce qui a changé"
        subtitle="Le journal des évolutions visibles de l'application, la plus récente en premier."
      />
      {news.isLoading ? (
        <LoadingState />
      ) : !news.data || news.data.entries.length === 0 ? (
        <EmptyState title="Aucune nouveauté publiée pour l'instant." />
      ) : (
        <div className="space-y-6">
          {news.data.entries.map((e) => (
            <article key={e.slug} id={e.slug} className="card p-6">
              <div className="stat-label text-fg-dim mb-1">
                <time dateTime={e.date}>{formatDate(e.date)}</time>
              </div>
              <h2 className="font-display text-xl font-bold text-fg-bright mb-3">{e.title}</h2>
              {/* HTML produit par cadence depuis le Markdown du dépôt, texte échappé à la génération. */}
              <div
                className="text-fg leading-relaxed space-y-3 [&_a]:text-accent-bright [&_a:hover]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_code]:text-xs [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:rounded"
                dangerouslySetInnerHTML={{ __html: e.html }}
              />
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
          ))}
        </div>
      )}
    </>
  );
}
