// L47 — pastille « nouveau » des Nouveautés (porté d'ol-companion L22, revues comprises) :
// entrées non vues depuis la dernière visite.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NEWS_SEEN_KEY,
  seenSeparatorIndex,
  badgeLabel,
  countUnseen,
  isUnseen,
  markAllSeen,
  readSeen,
  seenSeparatorLabel,
  sinceLabel,
  unseenLabel,
  type StorageLike,
} from './news-badge';

class MemoryStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const entries = [
  { slug: 'c', date: '2026-09-10' },
  { slug: 'b', date: '2026-09-10' },
  { slug: 'a', date: '2026-09-09' },
];

describe('news-badge', () => {
  it('clé propre à l’application', () => {
    expect(NEWS_SEEN_KEY).toBe('finance.news.seen-v1');
  });

  it('premier visiteur (aucune visite mémorisée) : rien n’est marqué nouveau', () => {
    expect(countUnseen(entries, null)).toBe(0);
    expect(entries.some((e) => isUnseen(e, null))).toBe(false);
    expect(readSeen(null)).toBeNull();
    expect(readSeen(new MemoryStorage())).toBeNull();
  });

  it('visiter marque tout vu ; la pastille tombe à zéro', () => {
    const st = new MemoryStorage();
    const seen = markAllSeen(st, entries, new Date('2026-09-25T11:57:30Z'));
    expect(seen).toEqual({ date: '2026-09-10', slugs: ['b', 'c'], seen: ['a', 'b', 'c'], at: '2026-09-25T11:57:30.000Z' });
    expect(readSeen(st)).toEqual(seen);
    expect(countUnseen(entries, readSeen(st))).toBe(0);
  });

  it('une entrée du même jour non vue compte comme nouvelle ; une plus récente aussi', () => {
    const st = new MemoryStorage();
    markAllSeen(st, entries);
    const later = [{ slug: 'e', date: '2026-09-11' }, { slug: 'd', date: '2026-09-10' }, ...entries];
    expect(countUnseen(later, readSeen(st))).toBe(2);
    expect(later.map((e) => isUnseen(e, readSeen(st)))).toEqual([true, true, false, false, false]);
    markAllSeen(st, later);
    expect(readSeen(st)!.date).toBe('2026-09-11');
    expect(readSeen(st)!.slugs).toEqual(['e']);
    expect(countUnseen(later, readSeen(st))).toBe(0);
  });

  it('instants comparés en millisecondes : 13:15:00Z et 13:15Z sont le même instant', () => {
    const st = new MemoryStorage();
    st.setItem(NEWS_SEEN_KEY, JSON.stringify({ date: '2026-09-28T13:15:00Z', slugs: ['soir'] }));
    expect(
      countUnseen(
        [
          { slug: 'soir', date: '2026-09-28T13:15Z' },
          { slug: 'matin', date: '2026-09-28T07:20Z' },
        ],
        readSeen(st),
      ),
    ).toBe(0);
    expect(countUnseen([{ slug: 'nuit', date: '2026-09-28T21:05Z' }], readSeen(st))).toBe(1);
  });

  it('mémoire corrompue ou stockage en panne : pas d’exception', () => {
    const st = new MemoryStorage();
    st.setItem(NEWS_SEEN_KEY, '{pas du json');
    expect(readSeen(st)).toBeNull();
    st.setItem(NEWS_SEEN_KEY, JSON.stringify({ date: 'hier', slugs: [] }));
    expect(readSeen(st)).toBeNull();
    st.setItem(NEWS_SEEN_KEY, JSON.stringify({ date: '2026-09-10', slugs: ['b', 3], at: 42 }));
    expect(readSeen(st)).toEqual({ date: '2026-09-10', slugs: ['b'] });
    st.setItem(NEWS_SEEN_KEY, JSON.stringify({ date: '2026-09-10', slugs: ['b'], seen: 'pas une liste' }));
    expect(readSeen(st)).toEqual({ date: '2026-09-10', slugs: ['b'] });
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('quota');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
    };
    expect(readSeen(broken)).toBeNull();
    expect(markAllSeen(broken, entries)!.date).toBe('2026-09-10');
    expect(markAllSeen(st, [])).toBeNull();
  });

  it('journal réel (nouveautes.json) : visite puis relecture → pastille éteinte', () => {
    const data = JSON.parse(
      readFileSync(resolve(__dirname, '../../public/nouveautes-data/nouveautes.json'), 'utf8'),
    ) as { entries: { slug: string; date: string }[] };
    const st = new MemoryStorage();
    markAllSeen(st, data.entries);
    expect(badgeLabel(countUnseen(data.entries, readSeen(st)))).toBe('');
  });

  it('libellés : pastille vide à zéro, « 9+ » au-delà de neuf ; textes pour lecteur d’écran accordés', () => {
    expect(badgeLabel(0)).toBe('');
    expect(badgeLabel(3)).toBe('3');
    expect(badgeLabel(12)).toBe('9+');
    expect(unseenLabel(0)).toBe('');
    expect(unseenLabel(1)).toBe('1 nouveauté non vue');
    expect(unseenLabel(4)).toBe('4 nouveautés non vues');
    expect(sinceLabel(0)).toBe('');
    expect(sinceLabel(1)).toBe('1 nouveauté depuis votre dernière visite');
    expect(sinceLabel(3)).toBe('3 nouveautés depuis votre dernière visite');
    const visit = { date: '2026-09-28', slugs: [], at: '2026-09-29T08:00:00.000Z' };
    expect(sinceLabel(2, visit)).toBe('2 nouveautés depuis votre dernière visite');
  });

  // Revue UX L47 : la ligne de base (aucun instant de visite) n'est pas une « visite » —
  // même mot que le séparateur « … lors de votre première visite ».
  it('ligne de base sans instant de visite : « depuis votre première visite »', () => {
    const baseline = { date: '2026-09-28', slugs: [] };
    expect(sinceLabel(0, baseline)).toBe('');
    expect(sinceLabel(1, baseline)).toBe('1 nouveauté depuis votre première visite');
    expect(sinceLabel(3, baseline)).toBe('3 nouveautés depuis votre première visite');
  });

  // Revue ol-companion L22 : une entrée publiée aujourd'hui mais datée d'avant la dernière visite
  // (rédigée en retard, antidatée) doit compter comme nouvelle.
  it('entrée antidatée publiée après la visite : nouvelle (slugs vus mémorisés)', () => {
    const st = new MemoryStorage();
    markAllSeen(st, entries);
    const withBackdated = [...entries.slice(0, 2), { slug: 'antidatee', date: '2026-09-09' }, entries[2]];
    expect(withBackdated.map((e) => isUnseen(e, readSeen(st)))).toEqual([false, false, true, false]);
    expect(countUnseen(withBackdated, readSeen(st))).toBe(1);
    markAllSeen(st, withBackdated);
    expect(countUnseen(withBackdated, readSeen(st))).toBe(0);
  });

  it('mémoire d’avant cette version (sans liste des vus) : règle par date conservée', () => {
    const st = new MemoryStorage();
    st.setItem(NEWS_SEEN_KEY, JSON.stringify({ date: '2026-09-10', slugs: ['b', 'c'] }));
    expect(countUnseen(entries, readSeen(st))).toBe(0);
    expect(countUnseen([{ slug: 'd', date: '2026-09-10' }, ...entries], readSeen(st))).toBe(1);
  });

  it('premier visiteur : toujours rien de nouveau, même avec une entrée antidatée', () => {
    expect(countUnseen([{ slug: 'antidatee', date: '2020-01-01' }, ...entries], null)).toBe(0);
  });

  it('séparateur « Déjà vu » : avant la première entrée vue, seulement si toutes les nouvelles sont au-dessus', () => {
    expect(seenSeparatorIndex([true, true, false, false])).toBe(2);
    expect(seenSeparatorIndex([false, false])).toBe(-1); // rien de nouveau
    expect(seenSeparatorIndex([true, true])).toBe(-1); // tout est nouveau
    // Nouvelle entrée antidatée plus bas : aucun séparateur (une « Nouveau » sous « Déjà vu » mentirait).
    expect(seenSeparatorIndex([true, false, true, false])).toBe(-1);
    expect(seenSeparatorIndex([false, true, false])).toBe(-1);
  });

  it('ligne de base d’un nouveau venu (sans visite de la page) : tout est vu, sans instant de visite', () => {
    const st = new MemoryStorage();
    const base = markAllSeen(st, entries, new Date('2026-10-02T08:00:00Z'), { visit: false });
    expect(base).toEqual({ date: '2026-09-10', slugs: ['b', 'c'], seen: ['a', 'b', 'c'] });
    expect(readSeen(st)).toEqual(base);
    expect(countUnseen([{ slug: 'nouvelle', date: '2026-10-02' }, ...entries], readSeen(st))).toBe(1);
  });

  it('séparateur : « Déjà vu lors de votre visite du … » (1er en ordinal) ; ligne de base : « Déjà publié lors de votre première visite »', () => {
    expect(seenSeparatorLabel({ date: '2026-09-10', slugs: [], at: '2026-10-01T08:05:00Z' }, 'UTC')).toBe(
      'Déjà vu lors de votre visite du 1er octobre 2026 à 08:05',
    );
    expect(seenSeparatorLabel({ date: '2026-09-10', slugs: [], at: '2026-09-28T19:40:00Z' }, 'UTC')).toBe(
      'Déjà vu lors de votre visite du 28 septembre 2026 à 19:40',
    );
    expect(seenSeparatorLabel({ date: '2026-09-10', slugs: [] })).toBe(
      "Déjà publié lors de votre première visite de l'application",
    );
  });
});
