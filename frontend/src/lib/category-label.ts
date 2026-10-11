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
  bonus: 'Prime',
  travel: 'Voyage',
  reimbursement: 'Remboursement',
  refund: 'Remboursement',
  transfer: 'Virement',
  shopping: 'Achats',
  education: 'Éducation',
  gift: 'Cadeau',
  charity: 'Don',
  clothing: 'Vêtements',
  internet: 'Internet',
  phone: 'Téléphone',
  parking: 'Parking',
  toll: 'Péage',
  pharmacy: 'Pharmacie',
  cash: 'Espèces',
  withdrawal: 'Retrait',
  unemployment: 'Chômage',
  allowance: 'Allocation',
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

/** Recherche du détail de relevé : description ou libellé affiché de la catégorie. */
export function transactionMatchesSearch(
  t: { description: string; category: string; subcategory: string },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const shown = categoryLabelFr(t.subcategory || categoryLabelFr(t.category));
  return t.description.toLowerCase().includes(q) || shown.toLowerCase().includes(q);
}
