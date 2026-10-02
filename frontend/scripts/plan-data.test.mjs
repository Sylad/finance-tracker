// @vitest-environment node
// L48 — générateur des données publiques de la page « Plan de travail ».
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { buildPlan, checkPublicTitle, findLeaks, isDenied, isProcessLot, privateTexts, readNewsTitles, readPlan, renderPlan, scanDir } from './plan-data.mjs';

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
        { id: 't3', title: 'Piste abandonnée', public: 'Une piste abandonnée', status: 'dropped', reason: 'raison privée de l’abandon' },
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

  it('L50 : les sous-tâches abandonnées (dropped) ne sortent pas (ni dans n/m, ni « à faire »)', () => {
    expect(plan.lots[0].tasks).toHaveLength(2);
    expect(renderPlan(plan)).not.toContain('abandonnée');
    const only = buildPlan({ project: 'x', lots: [{ id: 'L1', title: 'A', public: 'A', status: 'doing', visible: true, tasks: [{ id: 't1', status: 'dropped' }] }] });
    expect(only.lots[0].tasks).toBeUndefined();
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
  // L50 : `public:` doit être une chaîne d'une seule ligne.
  it.each(['Ligne 1\nligne 2', 'Retour\r chariot', 'Séparateur\u2028de ligne'])('rejette un retour à la ligne (%j)', (t) => {
    expect(() => checkPublicTitle(t, 'L1')).toThrow(/titre public.*ligne/);
  });
  it.each([2026, true, { a: 1 }, ['x'], null, undefined])('rejette une valeur qui n’est pas du texte (%j)', (t) => {
    expect(() => checkPublicTitle(t, 'L1')).toThrow(/titre public/);
  });
  it('YAML « public: 2026 » (nombre) refusé à la génération, aussi sur une sous-tâche', () => {
    expect(() => buildPlan({ project: 'x', lots: [{ id: 'L1', title: 'A', public: 2026, status: 'todo', visible: true }] })).toThrow(/pas du texte/);
    expect(() => buildPlan({ project: 'x', lots: [{ id: 'L1', title: 'A', public: 'A', status: 'todo', visible: true, tasks: [{ id: 't1', public: 12, status: 'todo' }] }] })).toThrow(/pas du texte/);
  });
});

describe('textes privés et fuites (L50)', () => {
  const plan = buildPlan(raf, { newsTitles: news });

  it('privateTexts : notes, verdicts, raisons (dès 12 caractères), titres bruts (dès 20) — jamais un titre publié', () => {
    const texts = privateTexts(raf, plan);
    expect(texts).toEqual(expect.arrayContaining([
      'note privée 1234 €', 'raison privée de l’abandon', 'Page publique (route /x, localStorage)', 'Nouvelle page (titre brut)',
      'Prévu sans titre public ni Nouveauté', 'Corriger une faille de sécurité',
    ]));
    expect(texts).not.toContain('Textes plus contrastés'); // public: de sous-tâche publié
    expect(texts).not.toContain('Correctif interne'); // titre brut < 20 caractères : trop générique
    expect(texts).not.toContain('conforme'); // verdict < 12 caractères
    expect(findLeaks(raf, renderPlan(plan), plan)).toEqual([]);
  });

  const note = 'note privée 1234 €';
  it('findLeaks repère une note brute, échappée JSON, en \\uXXXX (minuscules et majuscules)', () => {
    expect(findLeaks(raf, `bundle ${note} fin`, plan)).toEqual([note]);
    expect(findLeaks(raf, 'x="note priv\\u00e9e 1234 \\u20ac"', plan)).toEqual([note]);
    expect(findLeaks(raf, 'x="note priv\\u00E9e 1234 \\u20AC"', plan)).toEqual([note]);
  });

  it('findLeaks repère la forme \\xHH écrite par esbuild (≤ 0xFF), \\uHHHH au-delà, et les entités numériques', () => {
    expect(findLeaks(raf, 'x="note priv\\xE9e 1234 \\u20AC"', plan)).toEqual([note]);
    expect(findLeaks(raf, 'x="raison priv\\xe9e de l\\u2019abandon"', plan)).toEqual(['raison privée de l’abandon']);
    expect(findLeaks(raf, '<p>raison priv&#233;e de l&#8217;abandon</p>', plan)).toEqual(['raison privée de l’abandon']);
  });

  it('faux positif évité : titre court ou contenu dans un titre publié affiché par l’interface', () => {
    const r = { project: 'x', lots: [{
      id: 'L1', title: 'Page Plan de travail', public: 'Une page Plan de travail : ce qui se prépare', status: 'doing', visible: true,
      notes: [{ text: 'court mais privé' }],
      tasks: [
        { id: 't1', title: 'Plan de travail', status: 'done' },
        { id: 't2', title: 'Une page Plan de travail', status: 'todo' },
        { id: 't3', title: 'Lien Plan de travail dans le tiroir du téléphone', status: 'todo' },
      ],
    }] };
    const p = buildPlan(r);
    const ui = '<h1>Plan de travail</h1><p>Une page Plan de travail : ce qui se prépare</p>';
    expect(findLeaks(r, ui, p)).toEqual([]);
    expect(findLeaks(r, `${ui} "Lien Plan de travail dans le tiroir du téléphone"`, p)).toEqual(['Lien Plan de travail dans le tiroir du téléphone']);
    expect(findLeaks(r, `${ui} court mais privé`, p)).toEqual(['court mais privé']);
  });

  it('scanDir : une fuite plantée en \\xHH dans un bundle est trouvée et le fichier nommé ; dossier propre = rien', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plan-dist-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<html></html>');
    writeFileSync(join(dir, 'assets', 'app.js'), 'const a = "rien";');
    expect(scanDir(raf, plan, dir)).toEqual([]);
    writeFileSync(join(dir, 'assets', 'plan-x.js'), 'var e="note priv\\xE9e 1234 \\u20AC";');
    expect(scanDir(raf, plan, dir)).toEqual([{ file: join('assets', 'plan-x.js'), text: note }]);
  });
});

// Revue L50 (fuite) : une note avec apostrophe, guillemet double et lettre accentuée est
// écrite par esbuild en gabarit `…` avec un « " » brut et des \xHH — forme non cherchée.
describe('fuites : guillemets, apostrophes et gabarits (revue L50)', () => {
  const QUOTED = 'Le client a dit "c\'est d\'accord" pour l\'étape n° 2';
  const SINGLE = 'Le client a répondu "oui" à l’étape n° 3 du dossier';
  const TEMPLATE = 'Le code `npm run plan` et ${x} : "c\'est" l\'étape';
  const r = { project: 'x', lots: [{ id: 'L1', title: 'A', public: 'A', status: 'todo', visible: true,
    notes: [{ text: QUOTED }, { text: SINGLE }, { text: TEMPLATE }] }] };
  const p = buildPlan(r);
  const bundled = (s) => transformSync(`export const a=${JSON.stringify(s)};console.log(a)`, { minify: true }).code;

  it('forme réelle d’esbuild (gabarit avec " brut et \\xHH) : trouvée', () => {
    const code = bundled(QUOTED);
    expect(code).toContain('`Le client a dit "c\'est d\'accord" pour l\'\\xE9tape n\\xB0 2`');
    expect(findLeaks(r, code, p)).toEqual([QUOTED]);
  });

  it('chaîne entre apostrophes avec " brut et \\xHH / \\uHHHH : trouvée', () => {
    expect(findLeaks(r, bundled(SINGLE), p)).toEqual([SINGLE]);
    expect(findLeaks(r, `'Le client a r\\u00e9pondu "oui" \\u00e0 l\\u2019\\u00e9tape n\\u00b0 3 du dossier'`, p)).toEqual([SINGLE]);
  });

  it('apostrophes échappées en \\\' (autre minifieur) avec \\xHH : trouvée', () => {
    expect(findLeaks(r, `'Le client a dit "c\\'est d\\'accord" pour l\\'\\xE9tape n\\xB0 2'`, p)).toEqual([QUOTED]);
    expect(findLeaks(r, `'Le client a dit "c\\'est d\\'accord" pour l\\'étape n° 2'`, p)).toEqual([QUOTED]);
  });

  it('gabarit avec accent grave et ${ échappés, \\xHH : trouvé ; forme esbuild réelle aussi', () => {
    expect(findLeaks(r, '`Le code \\`npm run plan\\` et \\${x} : "c\'est" l\'\\xE9tape`', p)).toEqual([TEMPLATE]);
    expect(findLeaks(r, bundled(TEMPLATE), p)).toEqual([TEMPLATE]);
  });
});

// Revue L50 : état de sous-tâche publié tel quel (String(t.status)).
describe('état des sous-tâches (revue L50)', () => {
  const lot = (tasks) => ({ project: 'x', lots: [{ id: 'L1', title: 'A', public: 'A', status: 'doing', visible: true, tasks }] });

  it('seuls todo / doing / done sortent ; un autre état est ignoré avec un avertissement, jamais publié', () => {
    const warn = vi.fn();
    const out = buildPlan(lot([
      { id: 't1', status: 'done' }, { id: 't2', status: 'doing' }, { id: 't3', status: 'todo' },
      { id: 't4', status: 'bloqué en attente du fournisseur' }, { id: 't5' }, { id: 't6', status: 'dropped' },
    ]), { warn });
    expect(out.lots[0].tasks).toEqual([{ status: 'done' }, { status: 'doing' }, { status: 'todo' }]);
    expect(JSON.stringify(out)).not.toMatch(/bloqu|undefined/);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toMatch(/L1\/t4/);
    expect(warn.mock.calls[1][0]).toMatch(/L1\/t5/);
  });

  it('sous-tâche écrite comme une simple chaîne : ignorée avec un avertissement, jamais « undefined »', () => {
    const warn = vi.fn();
    const out = buildPlan(lot(['Faire la page détaillée du compte', { id: 't2', status: 'todo' }]), { warn });
    expect(out.lots[0].tasks).toEqual([{ status: 'todo' }]);
    expect(renderPlan(out)).not.toMatch(/undefined|Faire la page/);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/L1/);
  });

  it('le plan réel ne déclenche aucun avertissement', () => {
    const warn = vi.fn();
    buildPlan(readPlan(join(root, 'docs/plan/raf.yaml')), { newsTitles: readNewsTitles(join(root, 'frontend/public/nouveautes-data/nouveautes.json')), warn });
    expect(warn).not.toHaveBeenCalled();
  });
});

// Revue L50 : la vérification de fuite ne doit pas dépendre de la liste des champs connus.
describe('privateTexts : toutes les formes et tous les champs (revue L50)', () => {
  const r = { project: 'x', lots: [{
    id: 'L1', title: 'A', public: 'A', status: 'todo', visible: true,
    notes: 'Note écrite comme une simple chaîne',
    ux: { date: '2026-10-01', verdict: 'OK', reserves: ['Réserve numéro un du relecteur'], detail: { mesure: 'Mesure privée à 390 px de large' } },
    remarque: 'Champ inconnu au niveau du lot',
    tasks: [
      { id: 't1', status: 'todo', commentaire: 'Champ inconnu dans une sous-tâche', notes: 'Note de sous-tâche en chaîne' },
      'Sous-tâche écrite comme une simple chaîne',
    ],
  }] };
  const p = buildPlan(r, { warn: () => {} });

  it('notes en chaîne, toute chaîne sous ux:, champs inconnus (lot et sous-tâche), sous-tâche en chaîne', () => {
    expect(privateTexts(r, p)).toEqual(expect.arrayContaining([
      'Note écrite comme une simple chaîne',
      'Réserve numéro un du relecteur',
      'Mesure privée à 390 px de large',
      'Champ inconnu au niveau du lot',
      'Champ inconnu dans une sous-tâche',
      'Note de sous-tâche en chaîne',
      'Sous-tâche écrite comme une simple chaîne',
    ]));
    expect(findLeaks(r, 'x="Mesure priv\\xE9e \\xE0 390 px de large"', p)).toEqual(['Mesure privée à 390 px de large']);
  });

  it('jamais les identifiants, états ni dates (champs connus non textuels)', () => {
    const texts = privateTexts(r, p);
    for (const v of ['L1', 't1', 'todo', '2026-10-01']) expect(texts).not.toContain(v);
  });
});

describe('isProcessLot', () => {
  it('reconnaît les revues UX', () => {
    expect(isProcessLot({ title: 'Revue UX — Tableau de bord' })).toBe(true);
    expect(isProcessLot({ title: 'Page Nouveautés' })).toBe(false);
  });
});

describe('readNewsTitles', () => {
  it('L50 : lit nouveautes.json (ordre de la page) — titre de la PREMIÈRE entrée de chaque lot', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'news-')), 'nouveautes.json');
    writeFileSync(file, JSON.stringify({ entries: [
      { slug: '2026-09-10-b', title: 'Créée en dernier', date: '2026-09-10', lots: ['L1'] },
      { slug: '2026-09-10-a', title: 'Créée en premier', date: '2026-09-10', lots: ['L1', 'L2'] },
      { slug: '2026-09-01-c', title: 'Ancienne', date: '2026-09-01', lots: ['L2', 'L3'] },
    ] }));
    const m = readNewsTitles(file);
    expect(m.get('L1')).toBe('Créée en dernier');
    expect(m.get('L2')).toBe('Créée en premier');
    expect(m.get('L3')).toBe('Ancienne');
  });
  it('fichier absent ou illisible = aucune Nouveauté', () => {
    expect(readNewsTitles(join(tmpdir(), 'n-existe-pas-l50.json')).size).toBe(0);
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

  const NEWS = `${root}/frontend/public/nouveautes-data/nouveautes.json`;
  const realRaf = () => readPlan(`${root}/docs/plan/raf.yaml`);

  it('frontend/public/plan-data/plan.json est à jour avec docs/plan/raf.yaml et nouveautes.json (npm run plan)', () => {
    const expected = renderPlan(buildPlan(realRaf(), { newsTitles: readNewsTitles(NEWS) }));
    expect(committedText()).toBe(expected);
  });

  it('L50 : titre d’un lot et lien « Voir la nouveauté » viennent de la même entrée (première du lot dans nouveautes.json)', () => {
    const { entries } = JSON.parse(readFileSync(NEWS, 'utf8'));
    const titles = readNewsTitles(NEWS);
    expect(titles.size).toBeGreaterThan(0);
    for (const [lot, title] of titles) expect(entries.find((e) => e.lots.includes(lot)).title).toBe(title);
  });

  it('L50 : le plan réel a des textes privés à protéger, et AUCUN n’apparaît dans plan.json', () => {
    const committed = JSON.parse(committedText());
    expect(privateTexts(realRaf(), committed).length).toBeGreaterThan(20);
    expect(findLeaks(realRaf(), committedText(), committed)).toEqual([]);
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
