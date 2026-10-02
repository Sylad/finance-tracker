#!/usr/bin/env node
// L48 — données PUBLIQUES de la page « Plan de travail », tirées du plan raf
// (docs/plan/raf.yaml). Script Node autonome (seule dépendance : `yaml`),
// indépendant du framework : il sert de modèle aux autres sites.
//
//   node frontend/scripts/plan-data.mjs [--in docs/plan/raf.yaml]
//        [--news frontend/public/nouveautes-data/nouveautes.json]
//        [--out frontend/public/plan-data/plan.json] [--check]
//   cd frontend && node scripts/plan-data.mjs --in ../docs/plan/raf.yaml
//        --out public/plan-data/plan.json --leaks dist      (fin de npm run build, L50)
//
// --check n'écrit rien et sort en code 1 si le JSON versionné n'est plus à jour.
// --leaks sort en code 1 si un texte privé du plan (note, verdict UX, raison
// d'abandon, titre brut) se trouve dans un fichier du dossier construit ; sauté
// quand le plan brut est absent (build Docker, contexte frontend/).
//
// Le site est public. Règles dures :
//   1. seuls les lots `visible: true` (changements pour l'utilisateur) sortent ;
//   2. seuls id, titre PUBLIC, état, dates de début / fin et sous-tâches
//      (titre public éventuel, état) sortent — jamais le titre brut du plan,
//      les notes, estimations, shas, verdicts UX… Titre public = champ
//      `public:` du lot, sinon titre de sa Nouveauté, sinon lot masqué ;
//      les lots de processus (revues UX) exigent un `public:` ;
//   3. filet de sécurité : un lot dont le titre évoque la sécurité (liste
//      noire ci-dessous) n'est pas publié du tout ; une sous-tâche dans ce cas
//      est retirée de son lot (et du décompte n/m).
// Le JSON ne porte aucune date de génération : il ne dépend que du plan, ce
// qui permet au test de vérifier qu'il est à jour.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

/** États raf publiés ; tout autre état (dropped, inconnu) est écarté. */
export const PUBLISHED_STATUSES = ['doing', 'todo', 'done'];

// Comparaison sans casse ni accents (« Sécurité » = « securite »).
const DENY = [
  /securit/, /faille/, /spoof/, /injection/, /\btoken/, /\bjeton/, /secret/,
  /mot de passe/, /password/, /\bpin\b/, /\bcve\b/, /vulnerab/, /\bxss\b/,
  /\bcsrf\b/, /x-forwarded/, /forgeable/, /\bauth/, /bypass/,
];

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Vrai si le titre évoque un sujet de sécurité : le lot n'est alors jamais publié. */
export function isDenied(title) {
  const t = fold(String(title));
  return DENY.some((re) => re.test(t));
}

function day(v) {
  if (v == null || v === '') return undefined;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return undefined;
  return s.slice(0, 10);
}

/** Lots de processus (revues UX…) : jamais publiés sans `public:` explicite. */
const PROCESS = [/^revue\b/, /^audit\b/, /^campagne\b/];
export const isProcessLot = (lot) => PROCESS.some((re) => re.test(fold(String(lot?.title ?? '')).trim()));

export const PUBLIC_TITLE_MAX = 80;

/**
 * Titre montré au visiteur : ≤ 80 caractères, sans chemin, nom de technique ni
 * identifiant de lot. Non conforme → erreur (on corrige le plan, on ne publie pas).
 */
export function checkPublicTitle(title, where) {
  // L50 : `public:` est une chaîne d'une seule ligne (YAML « public: 2026 » donne un nombre).
  if (typeof title !== 'string') {
    throw new Error(`titre public de ${where} non conforme (pas du texte : ${JSON.stringify(title) ?? String(title)})`);
  }
  const t = title.trim();
  const why =
    !t ? 'vide'
      : /[\r\n\u2028\u2029]/.test(t) ? 'retour à la ligne'
      : t.length > PUBLIC_TITLE_MAX ? `${t.length} caractères (> ${PUBLIC_TITLE_MAX})`
        : /\//.test(t) ? 'contient « / »'
          : /\.ya?ml\b/i.test(t) ? 'cite un fichier'
            : /localstorage/i.test(t) ? 'nom de technique'
              : /\bL\d+\b/.test(t) ? 'cite un identifiant de lot'
                : isDenied(t) ? 'liste noire sécurité'
                  : null;
  if (why) throw new Error(`titre public de ${where} non conforme (${why}) : « ${t} »`);
  return t;
}

/**
 * Plan raf (objet YAML) → données publiques. Pur, sans E/S.
 * Titre d'un lot : `public:`, sinon titre de sa Nouveauté (`newsTitles`), sinon
 * le lot est masqué — jamais le titre brut du plan. Sous-tâche : `public:` ou
 * rien (elle ne compte alors que dans l'avancement n/m).
 */
export function buildPlan(raf, { newsTitles = new Map() } = {}) {
  if (!raf || !Array.isArray(raf.lots)) throw new Error('plan raf invalide : pas de liste « lots »');
  const lots = [];
  for (const lot of raf.lots) {
    if (lot?.visible !== true) continue;
    if (!PUBLISHED_STATUSES.includes(lot.status)) continue;
    if (isDenied(lot.title)) continue;
    const id = String(lot.id);
    let title = lot.public;
    if (title == null && !isProcessLot(lot)) title = newsTitles.get(id);
    if (title == null) continue;
    const out = { id, title: checkPublicTitle(title, id), status: lot.status };
    const started = day(lot.started);
    const finished = lot.status === 'done' ? day(lot.finished) : undefined;
    if (started) out.started = started;
    if (finished) out.finished = finished;
    // Sous-tâches abandonnées écartées (L50) : hors du décompte n/m, jamais « à faire ».
    const tasks = (Array.isArray(lot.tasks) ? lot.tasks : []).filter(
      (t) => t && t.status !== 'dropped' && !isDenied(t.title ?? ''),
    );
    if (tasks.length > 0) {
      out.tasks = tasks.map((t) =>
        t.public != null
          ? { title: checkPublicTitle(t.public, `${id}/${t.id}`), status: String(t.status) }
          : { status: String(t.status) },
      );
    }
    lots.push(out);
  }
  return { version: 1, project: String(raf.project ?? ''), lots };
}

/**
 * Journal des Nouveautés compilé (`frontend/public/nouveautes-data/nouveautes.json`,
 * `npm run news`) → titre de la PREMIÈRE entrée de chaque lot (L50). C'est le fichier et
 * l'ordre que lit la page : le titre publié et le lien « Voir la nouveauté »
 * (newsSlugByLot, première entrée du lot) viennent donc de la même entrée, même à date
 * égale. Fichier absent ou illisible = carte vide.
 */
export function readNewsTitles(file) {
  const m = new Map();
  let entries;
  try { entries = JSON.parse(readFileSync(file, 'utf8')).entries; } catch { return m; }
  for (const e of Array.isArray(entries) ? entries : []) {
    if (typeof e?.title !== 'string' || !Array.isArray(e.lots)) continue;
    for (const id of e.lots.map(String)) if (!m.has(id)) m.set(id, e.title);
  }
  return m;
}

/** Longueur minimale d'une note, d'un verdict ou d'une raison recherchés (en deçà, coïncidences). */
const MIN_PRIVATE = 12;
/**
 * Longueur minimale d'un TITRE (brut de lot ou de sous-tâche, `public:` de sous-tâche)
 * recherché : un titre court est une étiquette (« Plan de travail ») que l'interface
 * peut afficher légitimement — la chercher ferait échouer le build sur un faux positif.
 */
const MIN_TITLE = 20;

/**
 * Textes du plan qui ne doivent JAMAIS sortir (L50) : notes (lots et sous-tâches),
 * verdicts UX, raisons d'abandon (dès 12 caractères), titres bruts et `public:` de
 * sous-tâches (dès 20) — sauf un texte identique à un titre publié dans `plan` (lot ou
 * sous-tâche) ou contenu dans l'un d'eux (texte public par définition).
 */
export function privateTexts(raf, plan) {
  const published = (plan?.lots ?? []).flatMap((l) => [l.title, ...(l.tasks ?? []).map((t) => t.title)]).filter(Boolean);
  const out = new Set();
  const add = (v, min) => {
    if (v == null) return;
    const s = String(v).trim();
    if (s.length >= min && !published.some((p) => p.includes(s))) out.add(s);
  };
  const walk = (item, isTask) => {
    add(item?.title, MIN_TITLE);
    if (isTask) add(item?.public, MIN_TITLE);
    add(item?.reason, MIN_PRIVATE);
    add(item?.ux?.verdict, MIN_PRIVATE);
    for (const n of Array.isArray(item?.notes) ? item.notes : []) add(n?.text ?? n, MIN_PRIVATE);
    for (const t of Array.isArray(item?.tasks) ? item.tasks : []) walk(t, true);
  };
  for (const lot of raf?.lots ?? []) walk(lot, false);
  return [...out];
}

/**
 * Non-ASCII échappé comme dans un littéral JS : \uHHHH, ou \xHH pour les points de code
 * ≤ 0xFF quand `xhh` (forme écrite par esbuild : « pr\xE9pare »), hexadécimal en
 * minuscules ou majuscules.
 */
const escapeNonAscii = (s, upper, xhh) =>
  s.replace(/[^\x00-\x7f]/g, (c) => {
    const code = c.charCodeAt(0);
    const hex = (n) => { const h = code.toString(16).padStart(n, '0'); return upper ? h.toUpperCase() : h; };
    return xhh && code <= 0xff ? `\\x${hex(2)}` : `\\u${hex(4)}`;
  });

/**
 * Formes sous lesquelles un texte peut apparaître dans un fichier construit : brut,
 * échappé JSON, non-ASCII en \uXXXX ou \xHH (minuscules ou majuscules), non-ASCII en
 * entités HTML numériques (&#NNNN;). Les entités nommées ne sont pas cherchées (ni Vite
 * ni esbuild n'en produisent).
 */
function forms(s) {
  const json = JSON.stringify(s).slice(1, -1);
  const html = s.replace(/[^\x00-\x7f]/g, (c) => `&#${c.codePointAt(0)};`);
  const escaped = [false, true].flatMap((upper) => [false, true].map((xhh) => escapeNonAscii(json, upper, xhh)));
  return [...new Set([s, json, ...escaped, html])];
}

/** Textes privés du plan présents dans `text`. */
export function findLeaks(raf, text, plan) {
  return privateTexts(raf, plan).filter((s) => forms(s).some((f) => text.includes(f)));
}

/** Parcourt un dossier construit ; retourne { file, text } pour chaque fuite. */
export function scanDir(raf, plan, dir) {
  const walk = (d) =>
    readdirSync(d).flatMap((f) => {
      const p = join(d, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  const out = [];
  for (const file of walk(dir).sort()) {
    const text = readFileSync(file).toString('utf8');
    for (const t of findLeaks(raf, text, plan)) out.push({ file: relative(dir, file), text: t });
  }
  return out;
}

export const renderPlan = (plan) => JSON.stringify(plan, null, 2) + '\n';

export const readPlan = (path) => parse(readFileSync(path, 'utf8'));

function main(argv) {
  const arg = (name, def) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
  };
  const input = arg('--in', 'docs/plan/raf.yaml');
  const output = arg('--out', 'frontend/public/plan-data/plan.json');
  const newsFile = arg('--news', 'frontend/public/nouveautes-data/nouveautes.json');
  if (argv.includes('--leaks')) {
    const dir = arg('--leaks', 'dist');
    if (!existsSync(input)) {
      // Build Docker (contexte frontend/) : pas de plan brut à comparer ; la CI
      // « Contrôles frontend » et le build local font la vérification.
      console.log(`plan-data : ${input} absent, vérification des fuites sautée.`);
      return;
    }
    const leaks = scanDir(readPlan(input), JSON.parse(readFileSync(output, 'utf8')), dir);
    if (leaks.length > 0) {
      for (const l of leaks) console.error(`FUITE du plan dans ${dir}/${l.file} : « ${l.text.slice(0, 80)} »`);
      process.exit(1);
    }
    console.log(`plan-data : aucun texte privé du plan dans ${dir}/.`);
    return;
  }
  const json = renderPlan(buildPlan(readPlan(input), { newsTitles: readNewsTitles(newsFile) }));
  if (argv.includes('--check')) {
    let current = '';
    try { current = readFileSync(output, 'utf8'); } catch { /* absent = pas à jour */ }
    if (current !== json) {
      console.error(`${output} n'est pas à jour avec ${input} : lancer « npm run plan ».`);
      process.exit(1);
    }
    console.log(`${output} à jour.`);
    return;
  }
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, json);
  const n = JSON.parse(json).lots.length;
  console.log(`${output} : ${n} lot(s) publié(s).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
