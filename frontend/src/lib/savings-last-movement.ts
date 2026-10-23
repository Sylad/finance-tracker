import type { SavingsMovement } from '@/types/api';
import { formatEUR } from '@/lib/utils';

export interface LastMovement {
  text: string;
  tone: 'positive' | 'negative' | 'neutral';
}

const NATURE: Record<Exclude<SavingsMovement['source'], 'initial'>, string> = {
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
    text: `${last.source === 'detected' && last.amount < 0 ? 'Retrait détecté' : NATURE[last.source]} · ${day}/${month} : ${formatEUR(last.amount, true).replace('-', '−')}`,
    tone: last.source === 'bank-extract' ? 'neutral' : last.amount > 0 ? 'positive' : 'negative',
  };
}
