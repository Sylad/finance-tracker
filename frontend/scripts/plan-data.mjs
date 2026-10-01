#!/usr/bin/env node
// L48 — données PUBLIQUES de la page « Plan de travail », tirées du plan raf
// (docs/plan/raf.yaml). Script Node autonome (seule dépendance : `yaml`),
// indépendant du framework : il sert de modèle aux autres sites.
//
//   node frontend/scripts/plan-data.mjs [--in docs/plan/raf.yaml]
//        [--out frontend/public/plan-data/plan.json] [--check]
//
// --check n'écrit rien et sort en code 1 si le JSON versionné n'est plus à jour.
//
// Le site est public. Règles dures :
//   1. seuls les lots `visible: true` (changements pour l'utilisateur) sortent ;
//   2. seuls id, titre, état, dates de début / fin et sous-tâches (titre, état)
//      sortent — jamais les notes, estimations, shas, verdicts UX… ;
//   3. filet de sécurité : un lot dont le titre évoque la sécurité (liste
//      noire ci-dessous) n'est pas publié du tout ; une sous-tâche dans ce cas
//      est retirée de son lot (et du décompte n/m).
// Le JSON ne porte aucune date de génération : il ne dépend que du plan, ce
// qui permet au test de vérifier qu'il est à jour.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
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

/** Plan raf (objet YAML) → données publiques. Pur, sans E/S. */
export function buildPlan(raf) {
  if (!raf || !Array.isArray(raf.lots)) throw new Error('plan raf invalide : pas de liste « lots »');
  const lots = [];
  for (const lot of raf.lots) {
    if (lot?.visible !== true) continue;
    if (!PUBLISHED_STATUSES.includes(lot.status)) continue;
    if (isDenied(lot.title)) continue;
    const tasks = (Array.isArray(lot.tasks) ? lot.tasks : []).filter((t) => t && !isDenied(t.title ?? ''));
    const out = { id: String(lot.id), title: String(lot.title), status: lot.status };
    const started = day(lot.started);
    const finished = lot.status === 'done' ? day(lot.finished) : undefined;
    if (started) out.started = started;
    if (finished) out.finished = finished;
    if (tasks.length > 0) out.tasks = tasks.map((t) => ({ title: String(t.title), status: String(t.status) }));
    lots.push(out);
  }
  return { version: 1, project: String(raf.project ?? ''), lots };
}

export const renderPlan = (plan) => JSON.stringify(plan, null, 2) + '\n';

export const readPlan = (path) => parse(readFileSync(path, 'utf8'));

function main(argv) {
  const arg = (name, def) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
  };
  const input = arg('--in', 'docs/plan/raf.yaml');
  const output = arg('--out', 'frontend/public/plan-data/plan.json');
  const json = renderPlan(buildPlan(readPlan(input)));
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
