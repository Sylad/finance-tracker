import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NEWS_QUERY_KEY, fetchNews } from '@/lib/news-data';
import {
  NEWS_SEEN_EVENT,
  badgeLabel,
  browserStorage,
  countUnseen,
  markAllSeen,
  readSeen,
  unseenLabel,
} from '@/lib/news-badge';

/**
 * L47 — pastille « nouveau » du lien Nouveautés : entrées non vues depuis la dernière
 * visite (localStorage). Relue après la visite de /nouveautes (événement émis par la
 * page) et entre onglets (« storage »). Premier passage sans mémoire : pas de pastille,
 * mais une ligne de base est mémorisée dès que le journal est chargé (tout ce qui est
 * publié est vu, sans instant de visite) — une entrée publiée plus tard allumera la
 * pastille, même si le visiteur n'ouvre jamais la page Nouveautés.
 *
 * Monté par la navigation, donc seulement derrière le PIN (ou sur l'instance de démo) :
 * le journal est public, la page de connexion n'en montre rien.
 */
export function useNewsBadge(): { count: number; badge: string; label: string } {
  const query = useQuery({ queryKey: NEWS_QUERY_KEY, queryFn: fetchNews, staleTime: 5 * 60_000 });
  const [seen, setSeen] = useState(() => readSeen(browserStorage()));

  useEffect(() => {
    const refresh = () => setSeen(readSeen(browserStorage()));
    window.addEventListener(NEWS_SEEN_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(NEWS_SEEN_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const entries = query.data?.entries;
  useEffect(() => {
    if (!entries?.length) return;
    const storage = browserStorage();
    if (readSeen(storage)) return;
    markAllSeen(storage, entries, new Date(), { visit: false });
    setSeen(readSeen(storage));
  }, [entries]);

  const count = countUnseen(entries ?? [], seen);
  return { count, badge: badgeLabel(count), label: unseenLabel(count) };
}
