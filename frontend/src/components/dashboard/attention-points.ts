import type { HealthDiagnostic } from '@/types/api';
import { formatEUR } from '@/lib/utils';

/**
 * Tuile « Points d'attention » du tableau de bord (L21/t6). Le diagnostic
 * backend expose des phrases de règle (« orange car reste à vivre 5.7 % du
 * revenu < 10 % ») ; on les réécrit en français lisible, et chaque point
 * garde la couleur de SA règle (pas celle du verdict global).
 */

export type AttentionStatus = 'red' | 'orange';

export interface AttentionPoint {
  status: AttentionStatus;
  text: string;
}

const PCT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const pct = (s: string) => PCT.format(Number(s));
const eur = (s: string) => formatEUR(Number(s));
const NUM = '(-?\\d+(?:\\.\\d+)?)';

const RULES: Array<[RegExp, (...m: string[]) => string]> = [
  [new RegExp(`^reste à vivre ${NUM} % du revenu < ${NUM} %$`),
    (v, s) => `Reste à vivre : ${pct(v)} % du revenu (seuil ${pct(s)} %)`],
  [new RegExp(`^reste à vivre ${NUM} € < 0 €$`),
    (v) => `Reste à vivre négatif : ${eur(v)}`],
  [new RegExp(`^taux d'effort ${NUM} % [>≥] ${NUM} %$`),
    (v, s) => `Taux d'effort : ${pct(v)} % des revenus (seuil ${pct(s)} %)`],
  [new RegExp(`^(.+) utilisé à ${NUM} % ≥ ${NUM} %$`),
    (name, v, s) => `${name} utilisé à ${pct(v)} % du plafond (seuil ${pct(s)} %)`],
  [new RegExp(`^flux tirages ${NUM} €/mois > ${NUM} % du revenu \\(${NUM} €\\)$`),
    (v, p, t) => `Tirages : ${eur(v)}/mois, plus de ${pct(p)} % du revenu (${eur(t)})`],
  [new RegExp(`^tirages \\(${NUM} €/mois\\) > remboursements \\(${NUM} €/mois\\)$`),
    (t, r) => `Tirages (${eur(t)}/mois) supérieurs aux remboursements (${eur(r)}/mois)`],
  [new RegExp(`^l'encours projeté reste stable \\(± ${NUM} %\\) sous ${NUM} mois$`),
    (band, months) => `Encours des réserves stable sur ${months} mois (± ${pct(band)} %) : pas de désendettement`],
  [new RegExp(`^le solde mensuel moyen est structurellement négatif \\(${NUM} €\\)$`),
    (v) => `Solde mensuel moyen négatif : ${eur(v)}`],
  [/^l'encours projeté de (.+) atteint le plafond sous (\d+) mois$/,
    (name, months) => `Encours projeté de ${name} au plafond sous ${months} mois`],
];

export function humanizeCause(raw: string, fallback: AttentionStatus = 'orange'): AttentionPoint {
  const m = raw.trim().match(/^(rouge|orange) car (.+)$/s);
  const status: AttentionStatus = m ? (m[1] === 'rouge' ? 'red' : 'orange') : fallback;
  const body = m ? m[2].trim() : raw.trim();
  for (const [re, fmt] of RULES) {
    const hit = body.match(re);
    if (hit) return { status, text: fmt(...hit.slice(1)) };
  }
  const text = body.replace(/(\d)\.(\d)/g, '$1,$2');
  return { status, text: text.charAt(0).toUpperCase() + text.slice(1) };
}

const ORDER: Array<keyof HealthDiagnostic['blocks']> = ['resteAVivre', 'chargeDette', 'fluxTirages', 'trajectoire'];

export function attentionPoints(diagnostic: HealthDiagnostic): AttentionPoint[] {
  const points: AttentionPoint[] = [];
  for (const key of ORDER) {
    const block = diagnostic.blocks[key];
    if (!block || block.status === 'green' || !block.thresholdHit) continue;
    for (const part of block.thresholdHit.split(' ; ')) {
      points.push(humanizeCause(part, block.status));
    }
  }
  // Tri stable : rouges d'abord, ordre des blocs conservé ensuite.
  return [...points.filter((p) => p.status === 'red'), ...points.filter((p) => p.status === 'orange')];
}
