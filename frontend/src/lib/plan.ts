// L48 — logique PURE de la page « Plan de travail » : regroupement par état,
// avancement des sous-tâches, dates et âges en français. Les données viennent
// de /plan-data/plan.json, généré par `npm run plan` (frontend/scripts/plan-data.mjs)
// depuis docs/plan/raf.yaml : lots visibles seulement, titres et états.
import { formatNewsDay } from './news-data';

export type PlanStatus = 'doing' | 'todo' | 'done';

/** Étape d'une évolution : titre public facultatif (sans titre, elle ne compte que dans n/m). */
export interface PlanTask {
  title?: string;
  status: string;
}

export interface PlanLot {
  id: string;
  title: string;
  status: PlanStatus;
  started?: string;
  finished?: string;
  tasks?: PlanTask[];
}

export interface PlanData {
  version: number;
  project: string;
  lots: PlanLot[];
}

export interface PlanGroups {
  doing: PlanLot[];
  todo: PlanLot[];
  /** Livrés depuis moins de RECENT_DAYS jours, le plus récent en premier. */
  done: PlanLot[];
  /** Livrés plus anciens (ou sans date), non affichés. */
  olderDone: number;
}

export const RECENT_DAYS = 30;
const DAY = 86_400_000;

/** « AAAA-MM-JJ » → minuit local de ce jour. */
const atMidnight = (day: string) => new Date(`${day}T00:00:00`);
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysBetween = (day: string, today: Date) =>
  Math.round((startOfDay(today).getTime() - atMidnight(day).getTime()) / DAY);

export function groupPlan(lots: PlanLot[], today: Date, recentDays = RECENT_DAYS): PlanGroups {
  const doing = lots.filter((l) => l.status === 'doing');
  const todo = lots.filter((l) => l.status === 'todo');
  const allDone = lots.filter((l) => l.status === 'done');
  const done = allDone
    .filter((l) => l.finished && daysBetween(l.finished, today) <= recentDays)
    .sort((a, b) => (b.finished! < a.finished! ? -1 : b.finished! > a.finished! ? 1 : 0));
  return { doing, todo, done, olderDone: allDone.length - done.length };
}

/** Sous-tâches retenues : les abandonnées (dropped) ne comptent pas (le générateur les écarte déjà, L50). */
export const liveTasks = (lot: PlanLot): PlanTask[] => (lot.tasks ?? []).filter((t) => t.status !== 'dropped');

export function progress(lot: PlanLot): { done: number; total: number } | null {
  const tasks = liveTasks(lot);
  if (tasks.length === 0) return null;
  return { done: tasks.filter((t) => t.status === 'done').length, total: tasks.length };
}

/**
 * Avancement en mots (L50). Toutes les étapes faites d'un lot pas encore livré : « prêt,
 * en attente de livraison » (sinon « 3 sur 3 » laisse croire que c'est en ligne).
 */
export function progressText(p: { done: number; total: number }, status?: PlanStatus): string {
  const base = `${p.done} ${p.done > 1 ? 'étapes faites' : 'étape faite'} sur ${p.total}`;
  return status && status !== 'done' && p.total > 0 && p.done === p.total ? `${base} : prêt, en attente de livraison` : base;
}

/**
 * Étapes sans titre public, annoncées sous la liste des étapes avec leur état (revue UX
 * L50) : « + 2 autres étapes, faites », « + 1 autre étape, à faire », mélange :
 * « + 3 autres étapes, dont 2 faites ». Vide sans étape.
 */
export function untitledStepsLabel(tasks: PlanTask[]): string {
  const n = tasks.length;
  if (n === 0) return '';
  const done = tasks.filter((t) => t.status === 'done').length;
  const head = n > 1 ? `+ ${n} autres étapes` : '+ 1 autre étape';
  const fait = (k: number) => (k > 1 ? 'faites' : 'faite');
  if (done === n) return `${head}, ${fait(n)}`;
  if (done === 0) return `${head}, à faire`;
  return `${head}, dont ${done} ${fait(done)}`;
}

/** « 1er octobre 2026 » : même formateur que les Nouveautés (L50). */
export const formatDay = formatNewsDay;

export function ageLabel(day: string, today: Date): string {
  const n = daysBetween(day, today);
  if (n <= 0) return "aujourd'hui";
  if (n === 1) return 'hier';
  return `il y a ${n} jours`;
}

/**
 * Résumé « en ce moment », une phrase sans compte à zéro (L50) : « rien de prévu » plutôt
 * que « 0 prévue » ; le premier nombre porte le nom (« 2 évolutions prévues »).
 */
export function summary(g: PlanGroups): string {
  const parts: [number, string, string, string][] = [
    [g.doing.length, 'en cours', 'en cours', 'rien en cours'],
    [g.todo.length, 'prévue', 'prévues', 'rien de prévu'],
    [g.done.length, `livrée ces ${RECENT_DAYS} derniers jours`, `livrées ces ${RECENT_DAYS} derniers jours`, `rien de livré ces ${RECENT_DAYS} derniers jours`],
  ];
  let named = false;
  const text = parts
    .map(([n, one, many, none]) => {
      if (n === 0) return none;
      const noun = named ? '' : n > 1 ? 'évolutions ' : 'évolution ';
      named = true;
      return `${n} ${noun}${n > 1 ? many : one}`;
    })
    .join(', ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

export const isEmpty = (g: PlanGroups) => g.doing.length + g.todo.length + g.done.length === 0;

export const PLAN_URL = '/plan-data/plan.json';
/** Version du format produit par plan-data.mjs ; une autre version = erreur (L50). */
export const PLAN_VERSION = 1;
export const PLAN_QUERY_KEY = ['plan'] as const;

/**
 * Plan publié. 404 → null (aucun plan publié) ; toute autre panne — 500, réseau,
 * réponse non JSON (service worker hors ligne qui renvoie l'index), JSON sans
 * liste de lots, version inconnue — lève une erreur, pour un état « Réessayer » distinct.
 */
export async function fetchPlan(): Promise<PlanData | null> {
  const res = await fetch(PLAN_URL, { cache: 'no-cache' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`plan : HTTP ${res.status}`);
  const data = (await res.json()) as PlanData;
  if (!data || typeof data !== 'object' || !Array.isArray(data.lots)) throw new Error('plan : réponse inattendue');
  if (data.version !== PLAN_VERSION) throw new Error(`plan : version ${String(data.version)} inconnue`);
  return data;
}

/** Lot → slug de son entrée Nouveautés la plus récente (les entrées arrivent de la plus récente à la plus ancienne). */
export function newsSlugByLot(entries: { slug: string; lots: string[] }[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of entries) for (const id of e.lots) if (!m.has(id)) m.set(id, e.slug);
  return m;
}
