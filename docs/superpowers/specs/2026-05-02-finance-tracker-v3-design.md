# Finance Tracker V3 — Design

**Date** : 2026-05-02
**Auteur** : Sylad (avec Claude Code)
**Statut** : validé en brainstorming, en attente de plan d'implémentation

## Contexte & objectifs

V2 actuel : suivi mensuel basé sur l'import de relevés PDF (LBP), score de santé Claude, déclarations / forecast, page « Crédits récurrents » qui mélange salaire, loyers perçus, pensions.

V3 ré-organise et étend l'app autour de trois axes :

1. **Désambiguïser le vocabulaire** : « crédit » dans l'app actuelle = entrée d'argent au sens bancaire. Le langage utilisateur = « crédit » signifie emprunt. On adopte le langage utilisateur.
2. **Suivre le patrimoine** : pas seulement le solde du compte courant, mais aussi les comptes épargne (PEL, Livret A) et les emprunts (capital remboursé / restant, % temps écoulé).
3. **Démontrer l'app sans exposer ses vraies finances** : mode démo isolé.

## Décisions de cadrage

| # | Décision | Détail |
|---|----------|--------|
| D1 | Pages séparées Revenus / Crédits / Comptes épargne | Trois entrées sidebar distinctes |
| D2 | Détection des virements épargne par regex côté serveur | Réutilise pattern de `Declaration.matchPattern` |
| D3 | Intérêts annuels calculés auto à la date anniversaire | Taux configurable par compte (Livret A 1,50 %, PEL 2 %) |
| D4 | Crédits classiques = barre temporelle simple | Pas d'amortissement, pas de taux requis |
| D5 | Crédits revolving = saisie initiale + déduction des remboursements + bouton recaler | Pas d'import PDF revolving en V3 |
| D6 | Détection à l'import : Claude propose, l'utilisateur valide | Phase 2 du prompt enrichi |
| D7 | Bonus inclus V3 : patrimoine net, alertes simples, vue annuelle enrichie | Reste en backlog V4 |
| D8 | Mode démo via dataset isolé `data/demo/` + header HTTP | Aucune contamination des vraies données |
| D9 | Réponses Claude (commentaire santé, narrative) en français | Fix prompts système |

## Vocabulaire & navigation

| Avant | Après |
|-------|-------|
| Sidebar « Crédits récurrents » | Sidebar « Revenus » (route `/income`, ex `/recurring`) |
| Tile dashboard « Crédits » (somme entrées du mois) | Tile « Entrées » |
| (rien) | Sidebar « Crédits » (route `/loans`) |
| (rien) | Sidebar « Comptes épargne » (route `/savings`) |

La page « Déclarations » (route `/declarations`) reste — elle alimente le forecast et conserve son rôle. L'utilisateur peut toujours déclarer manuellement un crédit/abonnement/revenu pour le forecast, indépendamment du suivi de capital ou de balance épargne.

## Modèles backend

### `savings-account.model.ts`

```ts
export type SavingsAccountType = 'livret-a' | 'pel' | 'cel' | 'ldds' | 'pea' | 'other';

export interface SavingsAccount {
  id: string;
  name: string;
  type: SavingsAccountType;
  initialBalance: number;
  initialBalanceDate: string;          // YYYY-MM-DD
  matchPattern: string;                // regex sur description tx LBP
  interestRate: number;                // ex 0.015
  interestAnniversaryMonth: number;    // 1-12
  currentBalance: number;              // dénormalisé pour lecture rapide
  lastSyncedStatementId: string | null;
  movements: SavingsMovement[];
  createdAt: string;
  updatedAt: string;
}

export interface SavingsMovement {
  id: string;
  date: string;
  amount: number;                      // signe = sens (positif = entrée)
  source: 'initial' | 'detected' | 'manual' | 'interest';
  statementId: string | null;
  transactionId: string | null;
  note?: string;
}

export type SavingsAccountInput = Omit<
  SavingsAccount,
  'id' | 'currentBalance' | 'lastSyncedStatementId' | 'movements' | 'createdAt' | 'updatedAt'
>;
```

Stockage : `data/savings-accounts.json` (tableau).

### `loan.model.ts`

```ts
export type LoanType = 'classic' | 'revolving';
export type LoanCategory = 'mortgage' | 'consumer' | 'auto' | 'student' | 'other';

export interface Loan {
  id: string;
  name: string;
  type: LoanType;
  category: LoanCategory;
  monthlyPayment: number;
  matchPattern: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;

  // Classic-only (présent uniquement si type === 'classic')
  startDate?: string;
  endDate?: string;
  initialPrincipal?: number;           // optionnel, indicatif

  // Revolving-only
  maxAmount?: number;
  usedAmount?: number;
  lastManualResetAt?: string;          // dernière fois où l'utilisateur a recalé

  // Tracking
  occurrencesDetected: LoanOccurrence[];
}

export interface LoanOccurrence {
  id: string;
  statementId: string;
  date: string;
  amount: number;
  transactionId: string | null;
}

export type LoanInput = Omit<Loan, 'id' | 'occurrencesDetected' | 'createdAt' | 'updatedAt'>;
```

Stockage : `data/loans.json`.

### `loan-suggestion.model.ts`

Issu de la phase 2 Claude, présenté à l'utilisateur jusqu'à acceptation/rejet.

```ts
export interface LoanSuggestion {
  id: string;
  label: string;                       // libellé moyen
  monthlyAmount: number;
  occurrencesSeen: number;
  firstSeenStatementId: string;
  firstSeenDate: string;
  lastSeenDate: string;
  suggestedType: 'loan' | 'subscription' | 'utility';
  matchPattern: string;                // regex proposé
  status: 'pending' | 'accepted' | 'rejected' | 'snoozed';
  createdAt: string;
  resolvedAt?: string;
}
```

Stockage : `data/loan-suggestions.json`.

## Auto-MAJ à l'import d'un relevé

Nouveau service `AutoSyncService` injecté dans `StatementsService.analyze()`, exécuté après la persistance du `MonthlyStatement` :

1. **Comptes épargne** : pour chaque `SavingsAccount` actif :
   - Filtre les transactions du nouveau statement par `RegExp(matchPattern, 'i').test(tx.description)`.
   - Crée un `SavingsMovement` par tx matchée (source `detected`, signe = signe de la tx).
   - Si le mois du statement = `interestAnniversaryMonth` ET pas de mouvement `interest` cette année → calcule intérêts annuels (`balance moyenne pondérée × interestRate`, méthode quinzaine pour Livret A) et ajoute mouvement `interest`.
   - Met à jour `currentBalance`.
2. **Crédits** : pour chaque `Loan` actif :
   - Filtre les transactions matchées par regex.
   - Pour chaque match → crée `LoanOccurrence` (idempotent par `(statementId, transactionId)`).
   - Si revolving → décrémente `usedAmount` du montant remboursé.
3. **Suggestions** : un service dédié `LoanSuggestionService` récupère le champ `suggestedRecurringExpenses` du résultat Claude phase 2 → upsert dans `loan-suggestions.json` (regroupement par `matchPattern` normalisé : si une suggestion `pending` existe déjà avec le même pattern, on incrémente `occurrencesSeen` et MAJ `lastSeenDate` au lieu d'en créer une nouvelle ; les suggestions `rejected` ne sont jamais ressuscitées).
4. Émet un événement SSE `accounts-synced` (sur le canal `/api/events` existant) → invalidation de cache TanStack côté frontend.

**Idempotence** : `lastSyncedStatementId` sur chaque entité évite la double-application si un statement est ré-analysé. Si un statement est supprimé, on retire aussi tous les mouvements et occurrences associés (cleanup hook côté `StatementsService.delete()`).

**Validation regex** : côté DTO, `matchPattern` est validé via `try { new RegExp(pattern, 'i') } catch { 400 Bad Request }`. Côté `AutoSyncService`, chaque évaluation de pattern est entourée d'un `try/catch` qui logge un warning et passe au pattern suivant — un regex corrompu en stockage ne doit pas faire planter l'analyse de tout un statement.

## Détection auto par Claude

Modifs `analysis/anthropic.service.ts` :

```ts
// dans ANALYZE_TOOL.input_schema.properties
suggestedRecurringExpenses: {
  type: 'array',
  description: "Charges récurrentes détectées (≥ 2 occurrences même libellé) qui pourraient être des crédits, abonnements ou factures",
  items: {
    type: 'object',
    properties: {
      label: { type: 'string' },
      monthlyAmount: { type: 'number' },
      occurrencesSeen: { type: 'number' },
      firstSeenDate: { type: 'string' },
      suggestedType: { type: 'string', enum: ['loan', 'subscription', 'utility'] },
      matchPattern: { type: 'string', description: "Regex proposé (insensible à la casse)" },
    },
    required: ['label', 'monthlyAmount', 'occurrencesSeen', 'suggestedType', 'matchPattern'],
  },
},
```

Phase 2 reçoit en plus l'historique court des statements précédents (descriptions normalisées + montants) pour identifier la récurrence sur > 1 mois.

## Pages frontend

Toutes les pages utilisent les conventions existantes : `PageHeader`, `card`, tokens HSL, TanStack Query, lucide-react.

### `/income` (renommage)

Aucun changement fonctionnel, juste :
- Route renommée `/income`, fichier `routes/income.tsx`.
- `PageHeader` eyebrow « Revenus ».
- Sidebar label « Revenus ».
- Composant React et hook `useRecurringCredits` renommé `useIncome` côté frontend (l'endpoint backend reste `/api/recurring-credits` pour ne pas casser l'historique JSON).

### `/savings`

Grille responsive (1 carte par compte) :
- Carte = nom + type + solde courant en grand + delta du dernier import (badge ↑/↓) + sparkline 12 mois (`Recharts AreaChart`). La sparkline est calculée côté backend (endpoint `GET /api/savings-accounts/:id/balance-history?months=12`) en repliant les `movements` par mois et en propageant la balance fin-de-mois (forward-fill si aucun mouvement un mois donné).
- Footer carte : « Prochains intérêts : mois X » + lien « Voir les mouvements ».
- Bouton « + Ajouter un compte » → modal `SavingsAccountForm`.
- Modal détail compte : tableau des mouvements paginé + bouton « Mouvement manuel ».

### `/loans`

Deux sections : « Classiques » et « Revolving ».

- Encart « Suggestions » en haut si `LoanSuggestion[].status === 'pending'`. Cards compactes :
  ```
  [icône] PRELEVT CETELEM · 320 €/mois · vu 8 fois
  [Bouton C'est un crédit] [Plus tard] [Ce n'est pas un crédit]
  ```
  Cliquer « C'est un crédit » → modal `LoanForm` pré-rempli (label, monthlyPayment, matchPattern).

- **Carte crédit classique** :
  - Nom + catégorie + mensualité
  - Barre temporelle pleine largeur, % calculé `((today - startDate) / (endDate - startDate)) * 100`
  - Texte secondaire : « X / Y mensualités prélevées » (compteur via `occurrencesDetected.length`)
  - « Reste : N mois » (calculé)
  - Bouton menu : Éditer / Désactiver / Supprimer

- **Carte revolving** :
  - Nom + mensualité
  - Jauge `usedAmount / maxAmount` (vert <50, orange <80, rouge >80)
  - « X € utilisés sur Y € · Z € disponibles »
  - Bouton « Recaler le solde » (modal numérique)
  - Bouton menu : idem

### Dashboard (`/`)

- Tile « Crédits » → label « Entrées ».
- **Nouveau tile** « Patrimoine épargne » sous le solde de clôture : `Σ savingsAccount.currentBalance` + sparkline.
- **Nouveau tile** « Charge crédits » : `Σ loans.monthlyPayment` actifs + nb de crédits actifs.
- **Bonus (a) Patrimoine net** : nouveau bloc en haut « Patrimoine net = solde courant + Σ épargne − Σ capital restant dû estimé crédits classiques actifs ». Une seule ligne, gros chiffre. **Estimation grossière** du capital restant dû pour un crédit classique : `monthlyPayment × max(0, mois_restants_jusqu'à_endDate)`. Si `endDate` ou `monthlyPayment` manquant → crédit ignoré du calcul, et un petit pictogramme info à côté du chiffre liste les crédits non comptés (« Patrimoine net ne tient pas compte de N crédit(s) sans date de fin »).
- **Bonus (b) Alertes** : section conditionnelle « Alertes » au-dessus des graphes, lignes générées par règles côté backend :
  - Revolving > 80 % du max
  - Solde clôture en baisse > 30 % vs mois précédent
  - Crédit classique se terminant dans < 90 jours
- **Bonus (e) Vue annuelle enrichie** : section ajoutée en bas du dashboard avec graphique en barres entrées/sorties/épargne 12 mois glissants + top 5 postes de dépense agrégés.

## Fix langue dashboard

Dans `analysis/anthropic.service.ts` :

- `system` phase 1 : inchangé (extraction, pas de texte généré).
- `system` phase 2 :
  ```
  Tu es un analyste financier. Analyse les données de transactions fournies et appelle l'outil analyze_finances. **Toutes les chaînes de texte que tu produis (analysisNarrative, claudeHealthComment) doivent être rédigées en français.**
  ```
- `analysisNarrative.description` → `'Résumé en français en 2-3 phrases'`.
- `claudeHealthComment.description` → `'Forces et points d'attention en français'`.

Migration : les anciens commentaires anglais restent en base. Pas de re-traitement automatique. L'utilisateur peut ré-analyser un statement manuellement (endpoint `POST /api/statements/:id/reanalyze` à ajouter) pour avoir le commentaire en FR — utile pour les statements récents qu'il regarde encore.

## Mode démo

### Backend

- Variable env `DEMO_MODE_AVAILABLE=true` (défaut `true` en dev, à passer `false` en prod si besoin).
- Endpoint `GET /api/demo/status` → `{ available: bool, active: bool }`.
- Endpoint `POST /api/demo/seed` → génère le dataset démo dans `data/demo/` (idempotent : ne ré-écrase pas si présent, sauf `?force=true`).
- Endpoint `DELETE /api/demo/data` → supprime `data/demo/`.
- **Middleware `DemoModeMiddleware`** : intercepte toutes les routes `/api/*` (sauf `/api/demo/*`, `/api/health`). Si header `X-Demo-Mode: true` présent ET `DEMO_MODE_AVAILABLE` → marque `req.demoMode = true`. Un service scoped `RequestDataDirService` (provider `REQUEST` scope NestJS) lit ce flag et expose `getDataDir(): string` qui retourne `data/demo/` ou `data/` selon le contexte.
- **Refactor `StorageService`** : aujourd'hui `StorageService` lit `DATA_DIR` depuis `ConfigService` au boot via `@Injectable()` singleton. Pour qu'il puisse switcher par requête, on le passe en `Scope.REQUEST` et on injecte `RequestDataDirService`. Tous les services consommateurs deviennent eux-mêmes request-scoped (impact en cascade — à mesurer côté perf, mais pour cette app perso à faible trafic c'est acceptable).

### Frontend

- Toggle dans le menu utilisateur (header) : icône masque + label « Mode démo ».
- Au toggle ON → `POST /api/demo/seed` (au cas où) → `sessionStorage.setItem('demoMode', 'true')` → reload de toutes les queries TanStack.
- Intercepteur `fetch` ajoute `X-Demo-Mode: true` si flag actif.
- Banner orange persistant en haut de page tant que actif : « Mode démo — données fictives. [Quitter le mode démo] ».
- Au toggle OFF → suppression du flag + reload queries.

### Dataset démo (généré côté backend)

Profil fictif : Alex, 32 ans, salaire 2 800 € net, conjoint, 1 enfant, locataire (LBP également).

- 6 derniers statements générés synthétiquement avec dates, descriptions LBP-like, montants cohérents.
- 1 PEL « PEL Démo » à 12 450 € (versement initial 2018, mensuel 100 €).
- 1 Livret A « Livret A Démo » à 6 200 €.
- 2 crédits :
  - Classique « Crédit auto » 240 €/mois, 36 mois, 14 mois écoulés.
  - Revolving « Carte magasin » 3 000 € max, 1 200 € utilisés, mensualité 80 €.
- 1 revenu mensuel salaire + 1 ponctuel prime annuelle.
- Score santé pré-calculé varié (entre 65 et 82) pour montrer l'évolution.

Implémentation : `modules/demo/demo-seed.service.ts` avec un fichier de données statique JSON `demo-fixtures.json` versionné dans le repo (pas généré chaque fois — déterministe).

## Endpoints API ajoutés

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/savings-accounts` | Liste comptes |
| POST | `/api/savings-accounts` | Création |
| PUT | `/api/savings-accounts/:id` | Édition |
| DELETE | `/api/savings-accounts/:id` | Suppression |
| POST | `/api/savings-accounts/:id/movements` | Ajout mouvement manuel |
| POST | `/api/savings-accounts/:id/resync` | Force re-scan de tous les statements |
| GET | `/api/savings-accounts/:id/balance-history` | Série mensuelle balance fin-de-mois (param `months`) |
| GET | `/api/loans` | Liste crédits |
| POST | `/api/loans` | Création |
| PUT | `/api/loans/:id` | Édition |
| DELETE | `/api/loans/:id` | Suppression |
| POST | `/api/loans/:id/reset-revolving` | Recale solde revolving |
| GET | `/api/loan-suggestions` | Liste pending |
| POST | `/api/loan-suggestions/:id/accept` | Accepte → crée Loan |
| POST | `/api/loan-suggestions/:id/reject` | Rejette |
| POST | `/api/statements/:id/reanalyze` | Re-traite avec Claude (commentaire FR) |
| GET | `/api/dashboard/alerts` | Liste d'alertes (bonus b) |
| GET | `/api/dashboard/net-worth` | Patrimoine net (bonus a) |
| GET | `/api/dashboard/yearly-overview` | Agrégats 12 mois (bonus e) |
| GET | `/api/demo/status` | État mode démo |
| POST | `/api/demo/seed` | Génère dataset démo |
| DELETE | `/api/demo/data` | Reset démo |

## Migrations & impact sur l'existant

- **`MonthlyStatement` est inchangé** — pas de migration de données.
- Les fichiers JSON existants (`statements/`, `yearly/`, `recurring-credits.json`, `declarations.json`, `budget.json`) restent intacts.
- Nouveaux fichiers : `savings-accounts.json`, `loans.json`, `loan-suggestions.json`.
- Renommage frontend `/recurring` → `/income` : ajout d'un redirect `/recurring → /income` côté router pour ne pas casser les bookmarks éventuels.
- Backfill : à la première utilisation d'`AutoSyncService`, scanne tous les statements existants pour reconstruire `occurrencesDetected` des nouveaux crédits déclarés (bouton « Recalculer » sur chaque carte crédit).

## Tests

- Unit tests backend obligatoires sur :
  - `AutoSyncService.syncSavings()` : création mouvements, idempotence, calcul intérêts à l'anniversaire.
  - `AutoSyncService.syncLoans()` : matching regex, décrément revolving, idempotence.
  - `DemoModeMiddleware` : redirection `DATA_DIR`, isolation des données réelles.
  - `LoanSuggestionService` : déduplication, transitions de status.
- Tests d'intégration end-to-end sur l'enchaînement `POST /api/statements/analyze` → vérifie qu'un compte épargne avec pattern matchant voit son solde évoluer.

## Hors scope V3 (backlog V4)

- (c) Simulateur « et si je rembourse plus » sur crédits classiques.
- (d) Règles de catégorisation persistantes (mémorisation `pattern → category`).
- (f) Export PDF mensuel.
- (g) Anonymisation à la demande depuis vraies données.
- Import PDF revolving (Cofidis, Cetelem) pour MAJ exacte.
- Multi-utilisateurs / partage.

## Ordre d'implémentation suggéré

1. Fix langue dashboard (1 fichier modifié, ~30 min).
2. Modèles + endpoints CRUD comptes épargne + page `/savings`.
3. Modèles + endpoints CRUD crédits + page `/loans`.
4. `AutoSyncService` (épargne + crédits).
5. Détection Claude (`suggestedRecurringExpenses` dans phase 2) + UI suggestions.
6. Renommage `/recurring` → `/income` + tile dashboard « Entrées ».
7. Bonus (a) patrimoine net.
8. Bonus (b) alertes.
9. Bonus (e) vue annuelle enrichie.
10. Mode démo (middleware + dataset + UI toggle).

Chaque étape est livrable indépendamment et testable en isolation.
