import { TransactionCategory } from './transaction.model';

export type CategoryRuleSuggestionStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'snoozed';

/**
 * Une suggestion de règle de catégorisation, proposée par Claude depuis l'analyse
 * des transactions classées `other`. Une fois acceptée par l'utilisateur, elle
 * est convertie en `CategoryRule` (regex pattern + category cible) et appliquée
 * rétrospectivement aux transactions correspondantes.
 */
export interface CategoryRuleSuggestion {
  id: string;
  /** Pattern regex suggéré (échappé). Compilé via new RegExp(pattern, 'i'). */
  pattern: string;
  /** Catégorie cible (built-in ou user). */
  category: TransactionCategory | string;
  /** Sous-catégorie optionnelle (libellé court humain). */
  subcategory?: string;
  /** 1-5 descriptions exemples qui matchent ce pattern (pour aide à la décision). */
  exampleDescriptions: string[];
  /** Nombre total de transactions `other` qui matchent ce pattern. */
  occurrenceCount: number;
  /** Justification courte fournie par Claude (1 phrase). */
  rationale?: string;
  status: CategoryRuleSuggestionStatus;
  createdAt: string;
  resolvedAt?: string;
  /** Si status='accepted', id de la CategoryRule créée. */
  acceptedAsRuleId?: string;
}

/**
 * Sortie raw du tool Claude `suggest_category_rules`. Validée puis convertie
 * en CategoryRuleSuggestion par CategoryRuleSuggestionsService.
 */
export interface IncomingCategorySuggestion {
  pattern: string;
  category: string;
  subcategory?: string;
  exampleDescriptions: string[];
  occurrenceCount: number;
  rationale?: string;
}
