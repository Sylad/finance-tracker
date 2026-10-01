// @vitest-environment node
// L48 — générateur des données publiques de la page « Plan de travail ».
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildPlan, checkPublicTitle, isDenied, isProcessLot, readNewsTitles, readPlan, renderPlan } from './plan-data.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));

const raf = {
  version: 1,
  project: 'demo',
  prefix: 'L',
  lots: [
    {
      id: 'L1',
      title: 'Page publique (route /x, localStorage)',
      public: 'Une page publique',
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
        { id: 't1', title: 'Contraste fg-dim', public: 'Textes plus contrastés', status: 'done', notes: [{ date: '2026-09-02', text: 'privé' }] },
        { id: 't2', title: 'Clavier (tabindex)', status: 'todo', sha: 'abc1234' },
      ],
    },
    { id: 'L2', title: 'Correctif interne', public: 'Interne', status: 'done', started: '2026-09-02', finished: '2026-09-02' },
    { id: 'L3', title: 'Lot visible: false', status: 'todo', visible: false },
    { id: 'L4', title: 'Nouvelle page (titre brut)', status: 'doing', visible: true, started: '2026-09-04' },
    { id: 'L5', title: 'Prévu sans titre public ni Nouveauté', status: 'todo', visible: true },
    { id: 'L6', title: 'Abandonné', public: 'Abandonné', status: 'dropped', visible: true, finished: '2026-09-04' },
    { id: 'L7', title: 'État inconnu', public: 'Inconnu', status: 'blocked', visible: true },
    { id: 'L8', title: 'Corriger une faille de sécurité', public: 'Plus robuste', status: 'done', visible: true },
    { id: 'L9', title: 'Écran X', public: 'Écran X', status: 'todo', visible: true, tasks: [{ id: 't1', title: 'Le PIN se lit en clair', public: 'Saisie masquée', status: 'todo' }] },
    { id: 'L10', title: 'Revue UX — Écran Y', status: 'done', visible: true, finished: '2026-09-05' },
    { id: 'L11', title: 'Revue UX — Écran Z', public: 'Un écran Z plus lisible', status: 'todo', visible: true },
  ],
};
// L4 et L10 ont une entrée Nouveautés ; L10 est un lot de processus (revue UX) sans `public:`.
const news = new Map([['L4', 'Une nouvelle page'], ['L10', 'Écran Y revu']]);

describe('buildPlan', () => {
  const plan = buildPlan(raf, { newsTitles: news });

  it('publie les lots visibles ayant un titre public (public: puis Nouveauté), hors processus sans public:, liste noire et états inconnus', () => {
    expect(plan.lots.map((l) => l.id)).toEqual(['L1', 'L4', 'L9', 'L11']);
  });

  it('ne garde que id, titre public, état, dates et sous-tâches (titre public éventuel, état)', () => {
    expect(plan).toEqual({
      version: 1,
      project: 'demo',
      lots: [
        {
          id: 'L1',
          title: 'Une page publique',
          status: 'done',
          started: '2026-09-02',
          finished: '2026-09-03',
          tasks: [{ title: 'Textes plus contrastés', status: 'done' }, { status: 'todo' }],
        },
        { id: 'L4', title: 'Une nouvelle page', status: 'doing', started: '2026-09-04' },
        // Sous-tâche à titre brut sur liste noire : retirée, même avec un public:.
        { id: 'L9', title: 'Écran X', status: 'todo' },
        { id: 'L11', title: 'Un écran Z plus lisible', status: 'todo' },
      ],
    });
    const json = renderPlan(plan);
    for (const leak of ['PIN', 'Saisie', 'note', 'privé', '1234', 'abc1234', 'estimate', 'quickwin', 'conforme', 'created',
      'Correctif interne', 'titre brut', 'localStorage', 'tabindex', 'fg-dim', 'Revue UX']) {
      expect(json).not.toContain(leak);
    }
  });

  it('refuse un titre public non conforme (chemin, technique, identifiant, > 80 caractères)', () => {
    const one = (pub) => ({ project: 'x', lots: [{ id: 'L1', title: 'A', public: pub, status: 'todo', visible: true }] });
    for (const bad of ['Route /plan', 'Plan depuis raf.yaml', 'Pastille en localStorage', 'Suite de L12', 'x'.repeat(81)]) {
      expect(() => buildPlan(one(bad))).toThrow(/titre public/);
    }
    expect(() => buildPlan(one('y'.repeat(80)))).not.toThrow();
  });

  it('accepte les dates déjà converties en Date par un autre lecteur YAML', () => {
    const p = buildPlan({ project: 'x', lots: [{ id: 'L1', title: 'A', public: 'A', status: 'doing', visible: true, started: new Date('2026-09-04T00:00:00Z') }] });
    expect(p.lots[0].started).toBe('2026-09-04');
  });

  it('refuse un plan sans liste de lots', () => {
    expect(() => buildPlan({ project: 'x' })).toThrow(/lots/);
  });
});

describe('checkPublicTitle', () => {
  it.each(['a/b', 'raf.yaml', 'localStorage', 'voir L48', 'z'.repeat(81), ''])('rejette « %s »', (t) => {
    expect(() => checkPublicTitle(t, 'L1')).toThrow(/titre public/);
  });
});

describe('isProcessLot', () => {
  it('reconnaît les revues UX', () => {
    expect(isProcessLot({ title: 'Revue UX — Tableau de bord' })).toBe(true);
    expect(isProcessLot({ title: 'Page Nouveautés' })).toBe(false);
  });
});

describe('readNewsTitles', () => {
  it('lit le titre de la Nouveauté la plus récente de chaque lot', () => {
    const dir = mkdtempSync(join(tmpdir(), 'news-'));
    writeFileSync(join(dir, '2026-09-01-a.md'), '---\ntitle: "Ancien titre"\ndate: 2026-09-01\nlots: [L1, L2]\n---\nTexte.\n');
    writeFileSync(join(dir, '2026-09-10-b.md'), '---\ntitle: Nouveau titre\ndate: 2026-09-10\nlots: [L1]\n---\nTexte.\n');
    writeFileSync(join(dir, 'README.txt'), 'pas une entrée');
    const m = readNewsTitles(dir);
    expect(m.get('L1')).toBe('Nouveau titre');
    expect(m.get('L2')).toBe('Ancien titre');
  });
  it('dossier absent = aucune Nouveauté', () => {
    expect(readNewsTitles(join(tmpdir(), 'n-existe-pas-l48')).size).toBe(0);
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
  const committedText = () => readFileSync(`${root}/frontend/public/plan-data/plan.json`, 'utf8');

  it('frontend/public/plan-data/plan.json est à jour avec docs/plan/raf.yaml et docs/nouveautes (npm run plan)', () => {
    const expected = renderPlan(buildPlan(readPlan(`${root}/docs/plan/raf.yaml`), { newsTitles: readNewsTitles(`${root}/docs/nouveautes`) }));
    expect(committedText()).toBe(expected);
  });

  it('aucun titre publié ne contient de chemin, de technique, d’identifiant de lot, ni ne dépasse 80 caractères', () => {
    const committed = JSON.parse(committedText());
    const titles = committed.lots.flatMap((l) => [l.title, ...(l.tasks ?? []).map((t) => t.title).filter(Boolean)]);
    expect(titles.length).toBeGreaterThan(0);
    for (const t of titles) {
      expect(t).not.toMatch(/\/|\.yaml|localStorage|\bL\d+\b/);
      expect(t.length).toBeLessThanOrEqual(80);
      expect(isDenied(t)).toBe(false);
    }
  });
});
