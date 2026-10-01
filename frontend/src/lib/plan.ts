// L48 — logique PURE de la page « Plan de travail » : regroupement par état,
// avancement des sous-tâches, dates et âges en français. Les données viennent
// de /plan-data/plan.json, généré par `npm run plan` (frontend/scripts/plan-data.mjs)
// depuis docs/plan/raf.yaml : lots visibles seulement, titres et états.

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

export function progress(lot: PlanLot): { done: number; total: number } | null {
  if (!lot.tasks || lot.tasks.length === 0) return null;
  return { done: lot.tasks.filter((t) => t.status === 'done').length, total: lot.tasks.length };
}

export const formatDay = (day: string) =>
  atMidnight(day).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

export function ageLabel(day: string, today: Date): string {
  const n = daysBetween(day, today);
  if (n <= 0) return "aujourd'hui";
  if (n === 1) return 'hier';
  return `il y a ${n} jours`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Résumé « en ce moment », une phrase (« évolution », féminin). */
export function summary(g: PlanGroups): string {
  const doing = g.doing.length === 0 ? 'Rien en cours' : plural(g.doing.length, 'évolution en cours', 'évolutions en cours');
  return `${doing}, ${plural(g.todo.length, 'prévue', 'prévues')}, ${plural(g.done.length, 'livrée', 'livrées')} ces ${RECENT_DAYS} derniers jours.`;
}

export const isEmpty = (g: PlanGroups) => g.doing.length + g.todo.length + g.done.length === 0;

export const PLAN_URL = '/plan-data/plan.json';
export const PLAN_QUERY_KEY = ['plan'] as const;

/**
 * Plan publié. 404 → null (aucun plan publié) ; toute autre panne — 500, réseau,
 * réponse non JSON (service worker hors ligne qui renvoie l'index), JSON sans
 * liste de lots — lève une erreur, pour un état « Réessayer » distinct.
 */
export async function fetchPlan(): Promise<PlanData | null> {
  const res = await fetch(PLAN_URL, { cache: 'no-cache' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`plan : HTTP ${res.status}`);
  const data = (await res.json()) as PlanData;
  if (!data || !Array.isArray(data.lots)) throw new Error('plan : réponse inattendue');
  return data;
}

/** Lot → slug de son entrée Nouveautés la plus récente (les entrées arrivent de la plus récente à la plus ancienne). */
export function newsSlugByLot(entries: { slug: string; lots: string[] }[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of entries) for (const id of e.lots) if (!m.has(id)) m.set(id, e.slug);
  return m;
}
