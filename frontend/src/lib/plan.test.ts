import { afterEach, describe, expect, it, vi } from 'vitest';
import { ageLabel, fetchPlan, formatDay, groupPlan, isEmpty, liveTasks, newsSlugByLot, progress, progressText, summary, type PlanLot } from './plan';

const today = new Date('2026-10-01T10:00:00');

const lots: PlanLot[] = [
  { id: 'L1', title: 'Livré il y a longtemps', status: 'done', started: '2026-08-01', finished: '2026-08-15' },
  { id: 'L2', title: 'Livré hier', status: 'done', started: '2026-09-29', finished: '2026-09-30' },
  { id: 'L3', title: 'Prévu A', status: 'todo' },
  { id: 'L4', title: 'En cours', status: 'doing', started: '2026-10-01', tasks: [
    { title: 'a', status: 'done' }, { status: 'todo' }, { title: 'c', status: 'doing' },
  ] },
  { id: 'L5', title: 'Livré il y a 30 jours', status: 'done', finished: '2026-09-01' },
  { id: 'L6', title: 'Prévu B', status: 'todo' },
  { id: 'L7', title: 'Livré il y a 31 jours', status: 'done', finished: '2026-08-31' },
  { id: 'L8', title: 'Livré sans date', status: 'done' },
  { id: 'L9', title: 'Livré le 28', status: 'done', finished: '2026-09-28' },
];

describe('groupPlan', () => {
  const g = groupPlan(lots, today);

  it('en cours et prévus dans l’ordre du plan', () => {
    expect(g.doing.map((l) => l.id)).toEqual(['L4']);
    expect(g.todo.map((l) => l.id)).toEqual(['L3', 'L6']);
  });

  it('livrés des 30 derniers jours, le plus récent en premier', () => {
    expect(g.done.map((l) => l.id)).toEqual(['L2', 'L9', 'L5']);
    expect(g.olderDone).toBe(3);
  });
});

describe('progress', () => {
  it('compte les sous-tâches terminées', () => {
    expect(progress(lots[3])).toEqual({ done: 1, total: 3 });
  });
  it('L50 : les sous-tâches abandonnées ne comptent pas (ni dans n/m, ni à faire)', () => {
    const lot: PlanLot = { id: 'L', title: 'x', status: 'doing', tasks: [
      { title: 'a', status: 'dropped' }, { title: 'b', status: 'done' }, { status: 'todo' },
    ] };
    expect(progress(lot)).toEqual({ done: 1, total: 2 });
    expect(liveTasks(lot).map((t) => t.title)).toEqual(['b', undefined]);
    expect(progress({ ...lot, tasks: [{ status: 'dropped' }] })).toBeNull();
  });
  it('L50 : avancement en mots ; toutes les étapes faites d’un lot pas encore livré → « prêt, en attente de livraison »', () => {
    expect(progressText({ done: 1, total: 2 }, 'doing')).toBe('1 étape faite sur 2');
    expect(progressText({ done: 3, total: 3 }, 'doing')).toBe('3 étapes faites sur 3 : prêt, en attente de livraison');
    expect(progressText({ done: 2, total: 2 }, 'todo')).toBe('2 étapes faites sur 2 : prêt, en attente de livraison');
    expect(progressText({ done: 2, total: 2 }, 'done')).toBe('2 étapes faites sur 2');
  });
  it('null sans sous-tâche', () => {
    expect(progress(lots[2])).toBeNull();
    expect(progress({ ...lots[2], tasks: [] })).toBeNull();
  });
});

describe('dates en français', () => {
  it('formate un jour, « 1er » pour le premier du mois (formateur partagé avec les Nouveautés)', () => {
    expect(formatDay('2026-09-28')).toBe('28 septembre 2026');
    expect(formatDay('2026-10-01')).toBe('1er octobre 2026');
  });
  it('donne un âge lisible', () => {
    expect(ageLabel('2026-10-01', today)).toBe("aujourd'hui");
    expect(ageLabel('2026-09-30', today)).toBe('hier');
    expect(ageLabel('2026-09-28', today)).toBe('il y a 3 jours');
  });
});

describe('summary', () => {
  it('résume « en ce moment » en évolutions, pluriels accordés', () => {
    expect(summary(groupPlan(lots, today))).toBe('1 évolution en cours, 2 prévues, 3 livrées ces 30 derniers jours.');
    expect(summary({ doing: [lots[3], lots[3]], todo: [lots[2]], done: [lots[1]], olderDone: 0 })).toBe(
      '2 évolutions en cours, 1 prévue, 1 livrée ces 30 derniers jours.',
    );
    // L50 : jamais de compte à zéro ; le premier nombre porte le nom.
    expect(summary({ doing: [], todo: [], done: [], olderDone: 0 })).toBe(
      'Rien en cours, rien de prévu, rien de livré ces 30 derniers jours.',
    );
    expect(summary({ doing: [], todo: [lots[2], lots[5]], done: [lots[1]], olderDone: 0 })).toBe(
      'Rien en cours, 2 évolutions prévues, 1 livrée ces 30 derniers jours.',
    );
    expect(summary({ doing: [lots[3]], todo: [], done: [], olderDone: 2 })).toBe(
      '1 évolution en cours, rien de prévu, rien de livré ces 30 derniers jours.',
    );
  });
});

describe('isEmpty', () => {
  it('vrai seulement quand les trois groupes sont vides', () => {
    expect(isEmpty({ doing: [], todo: [], done: [], olderDone: 4 })).toBe(true);
    expect(isEmpty({ doing: [], todo: [lots[2]], done: [], olderDone: 0 })).toBe(false);
  });
});

describe('fetchPlan', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (r: unknown) => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(r));

  it('404 → null (aucun plan publié)', async () => {
    stub({ ok: false, status: 404 });
    await expect(fetchPlan()).resolves.toBeNull();
  });
  it('500 → erreur', async () => {
    stub({ ok: false, status: 500 });
    await expect(fetchPlan()).rejects.toThrow();
  });
  it('réponse non JSON (index.html du service worker hors ligne) → erreur', async () => {
    stub({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } });
    await expect(fetchPlan()).rejects.toThrow();
  });
  it('JSON sans liste de lots → erreur', async () => {
    stub({ ok: true, status: 200, json: async () => ({ hello: 1 }) });
    await expect(fetchPlan()).rejects.toThrow();
  });
  it('réseau coupé → erreur', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(fetchPlan()).rejects.toThrow();
  });
  it('L50 : version inconnue → erreur (état « Réessayer »)', async () => {
    stub({ ok: true, status: 200, json: async () => ({ version: 2, project: 'x', lots: [] }) });
    await expect(fetchPlan()).rejects.toThrow(/version/);
    stub({ ok: true, status: 200, json: async () => ({ project: 'x', lots: [] }) });
    await expect(fetchPlan()).rejects.toThrow(/version/);
  });
  it('plan valide', async () => {
    stub({ ok: true, status: 200, json: async () => ({ version: 1, project: 'x', lots: [] }) });
    await expect(fetchPlan()).resolves.toEqual({ version: 1, project: 'x', lots: [] });
  });
});

describe('newsSlugByLot', () => {
  it('associe chaque lot à sa dernière entrée Nouveautés', () => {
    const m = newsSlugByLot([
      { slug: 'b-recent', lots: ['L2'] },
      { slug: 'a-ancien', lots: ['L2', 'L9'] },
    ]);
    expect(m.get('L2')).toBe('b-recent');
    expect(m.get('L9')).toBe('a-ancien');
    expect(m.get('L4')).toBeUndefined();
  });
});
