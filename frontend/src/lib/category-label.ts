import { CATEGORY_LABELS, SUBSCRIPTION_CATEGORY_LABELS } from '@/types/api';

// Mots anglais que l'analyse ou une saisie libre peut produire comme
// sous-catégorie ou catégorie de déclaration, hors listes officielles.
const EXTRA_LABELS: Record<string, string> = {
  salary: 'Salaire',
  rental: 'Loyer perçu',
  pension: 'Pension',
  subsidy: 'Aide / Subvention',
  investment: 'Placement',
  loan: 'Crédit',
  mortgage: 'Prêt immobilier',
  rent: 'Loyer',
  utilities: 'Énergie / eau',
  tax: 'Impôts',
  fees: 'Frais bancaires',
  groceries: 'Courses',
  restaurant: 'Restaurant',
  fuel: 'Carburant',
};

const KNOWN: Record<string, string> = {
  ...EXTRA_LABELS,
  ...SUBSCRIPTION_CATEGORY_LABELS,
  ...CATEGORY_LABELS,
};

/** Libellé français d'une catégorie ; un libellé inconnu est rendu tel quel. */
export function categoryLabelFr(value: string): string {
  return KNOWN[value.trim().toLowerCase()] ?? value;
}
