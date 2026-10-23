import type { SavingsMovement } from '@/types/api';
import { formatEUR } from '@/lib/utils';

/** Nature affichée d'un mouvement : un mouvement détecté négatif est un « Retrait détecté ». */
function natureOf(m: SavingsMovement): string {
  return m.source === 'detected' && m.amount < 0 ? 'Retrait détecté' : NATURE[m.source];
}

const signed = (amount: number) => formatEUR(amount, true).replace('-', '−');

export interface LastMovement {
  text: string;
  tone: 'positive' | 'negative' | 'neutral';
}

const NATURE: Record<SavingsMovement['source'], string> = {
  initial: 'Solde initial',
  detected: 'Versement détecté',
  manual: 'Mouvement manuel',
  interest: 'Intérêts',
  'bank-extract': 'Ajustement au relevé',
};

/**
 * Dernier mouvement d'une carte Épargne : le plus récent par date (à date égale,
 * le dernier du tableau), solde initial exclu. « Nature · jj/mm : montant signé ».
 * Un mouvement détecté négatif est un « Retrait détecté ». Un ajustement au relevé recale le solde sur le relevé, il n'est ni un gain ni
 * une perte : ton neutre. Le signe moins est le vrai « − » (U+2212), quel que soit l'ICU. Aucun mouvement, ou un mouvement à 0 € : null.
 */
export function lastMovement(movements: SavingsMovement[]): LastMovement | null {
  let last: SavingsMovement | null = null;
  for (const m of movements) {
    if (m.source === 'initial') continue;
    if (!last || m.date >= last.date) last = m;
  }
  if (!last || last.source === 'initial' || last.amount === 0) return null;
  const [, month, day] = last.date.slice(0, 10).split('-');
  return {
    text: `${natureOf(last)} · ${day}/${month} : ${signed(last.amount)}`,
    tone: last.source === 'bank-extract' ? 'neutral' : last.amount > 0 ? 'positive' : 'negative',
  };
}

/** Note du backend rendue lisible : sans « Auto: », sans la nature déjà affichée, taux à la française. */
function noteOf(m: SavingsMovement): string | undefined {
  if (!m.note || m.source === 'initial') return undefined;
  const note = m.note
    .replace(/^Auto:\s*/, '')
    .replace(/^Intérêts\s+/, '')
    .replace(/(\d+)\.(\d+)%/g, '$1,$2\u00a0%')
    .trim();
  if (!note || (m.source === 'bank-extract' && note === 'Solde recalibré depuis le relevé')) return undefined;
  return note;
}

export interface MovementRow {
  id: string;
  date: string;
  nature: string;
  amount: string;
  tone: LastMovement['tone'];
  note?: string;
}

/** Liste des mouvements d'une carte, du plus récent au plus ancien (à date égale, le dernier du tableau d'abord), solde initial compris. */
export function movementRows(movements: SavingsMovement[]): MovementRow[] {
  return movements
    .map((m, k) => ({ m, k }))
    .sort((a, b) => (a.m.date === b.m.date ? b.k - a.k : a.m.date < b.m.date ? 1 : -1))
    .map(({ m }) => {
      const note = noteOf(m);
      const [year, month, day] = m.date.slice(0, 10).split('-');
      return {
        id: m.id,
        date: `${day}/${month}/${year}`,
        nature: natureOf(m),
        amount: signed(m.amount),
        tone: m.source === 'bank-extract' || m.source === 'initial' ? 'neutral' : m.amount > 0 ? 'positive' : m.amount < 0 ? 'negative' : 'neutral',
        ...(note ? { note } : {}),
      };
    });
}
