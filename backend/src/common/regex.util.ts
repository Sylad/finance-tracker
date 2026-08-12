/**
 * Échappe les caractères spéciaux regex d'une chaîne libre (ex. nom de
 * créancier) pour qu'elle soit utilisable telle quelle comme `matchPattern`
 * littéral. Partagé entre `DetectionValidatorService` et
 * `LoanSuggestionsService` (déduplication demandée en review T4).
 */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
