// @vitest-environment node
// L48 — générateur des données publiques de la page « Plan de travail ».
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildPlan, isDenied, renderPlan } from './plan-data.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));

const raf = {
  version: 1,
  project: 'demo',
  prefix: 'L',
  lots: [
    {
      id: 'L1',
      title: 'Page publique',
      status: 'done',
      visible: true,
      estimate: 0.5,
      quickwin: true,
      created: '2026-09-01',
      started: '2026-09-02',
      finished: '2026-09-03',
      ux: { date: '2026-09-03', verdict: 'conforme' },
      notes: [{ date: '2026-09-02', text: 'note privée 1234 €' }],
      tasks: [
        { id: 't1', title: 'Contraste', status: 'done', notes: [{ date: '2026-09-02', text: 'privé' }] },
        { id: 't2', title: 'Clavier', status: 'todo', sha: 'abc1234' },
      ],
    },
    { id: 'L2', title: 'Correctif interne', status: 'done', started: '2026-09-02', finished: '2026-09-02' },
    { id: 'L3', title: 'Lot visible: false', status: 'todo', visible: false },
    { id: 'L4', title: 'Nouvelle page', status: 'doing', visible: true, started: '2026-09-04' },
    { id: 'L5', title: 'Prévu', status: 'todo', visible: true },
    { id: 'L6', title: 'Abandonné', status: 'dropped', visible: true, finished: '2026-09-04' },
    { id: 'L7', title: 'État inconnu', status: 'blocked', visible: true },
    { id: 'L8', title: 'Corriger une faille de sécurité', status: 'done', visible: true },
    { id: 'L9', title: 'Écran X', status: 'todo', visible: true, tasks: [{ id: 't1', title: 'Le PIN se lit en clair', status: 'todo' }] },
  ],
};

describe('buildPlan', () => {
  const plan = buildPlan(raf);

  it('publie seulement les lots visibles, à un état connu et hors liste noire', () => {
    expect(plan.lots.map((l) => l.id)).toEqual(['L1', 'L4', 'L5', 'L9']);
  });

  it("ne garde que l'id, le titre, l'état, les dates et les sous-tâches (titre, état)", () => {
    expect(plan).toEqual({
      version: 1,
      project: 'demo',
      lots: [
        {
          id: 'L1',
          title: 'Page publique',
          status: 'done',
          started: '2026-09-02',
          finished: '2026-09-03',
          tasks: [
            { title: 'Contraste', status: 'done' },
            { title: 'Clavier', status: 'todo' },
          ],
        },
        { id: 'L4', title: 'Nouvelle page', status: 'doing', started: '2026-09-04' },
        { id: 'L5', title: 'Prévu', status: 'todo' },
        // La sous-tâche « Le PIN se lit en clair » est retirée, le lot reste.
        { id: 'L9', title: 'Écran X', status: 'todo' },
      ],
    });
    const json = renderPlan(plan);
    for (const leak of ['PIN', 'note', 'privé', '1234', 'abc1234', 'estimate', 'quickwin', 'conforme', 'created', 'Correctif interne']) {
      expect(json).not.toContain(leak);
    }
  });

  it('accepte les dates déjà converties en Date par un autre lecteur YAML', () => {
    const p = buildPlan({ project: 'x', lots: [{ id: 'L1', title: 'A', status: 'doing', visible: true, started: new Date('2026-09-04T00:00:00Z') }] });
    expect(p.lots[0].started).toBe('2026-09-04');
  });

  it('refuse un plan sans liste de lots', () => {
    expect(() => buildPlan({ project: 'x' })).toThrow(/lots/);
  });
});

describe('isDenied (filet de sécurité)', () => {
  it.each([
    'X-Forwarded-Host spoofable',
    'Corriger une faille',
    'Sécurité du login',
    'securite des sessions',
    'Injection SQL',
    'Renouveler le token',
    'Secret Kubernetes',
    'Changer le mot de passe',
    'Le PIN guard',
    'CVE-2026-1234',
    'Vulnérabilité XSS',
    'vulnerability scan',
    'Jeton de session',
    'CSRF sur /upload',
  ])('écarte « %s »', (title) => {
    expect(isDenied(title)).toBe(true);
  });

  it.each(['Page Nouveautés', 'Revue UX — Tableau de bord', 'Spinner plus visible', 'Opinion', 'Épingler un budget'])(
    'laisse passer « %s »',
    (title) => {
      expect(isDenied(title)).toBe(false);
    },
  );
});

describe('plan publié', () => {
  it('frontend/public/plan-data/plan.json est à jour avec docs/plan/raf.yaml (npm run plan)', async () => {
    const { readPlan } = await import('./plan-data.mjs');
    const expected = renderPlan(buildPlan(readPlan(`${root}/docs/plan/raf.yaml`)));
    const committed = readFileSync(`${root}/frontend/public/plan-data/plan.json`, 'utf8');
    expect(committed).toBe(expected);
  });

  it('ne publie aucun titre de la liste noire', () => {
    const committed = JSON.parse(readFileSync(`${root}/frontend/public/plan-data/plan.json`, 'utf8'));
    for (const lot of committed.lots) {
      expect(isDenied(lot.title)).toBe(false);
      for (const t of lot.tasks ?? []) expect(isDenied(t.title)).toBe(false);
    }
  });
});
