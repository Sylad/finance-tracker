# Step 02: Plan

**Task:** Refonte synchro crédits 3-sources robuste
**Started:** 2026-05-10T12:01:41Z

## Strategy : 6 commits séquentiels (un par item) — chaque commit auto-suffit + tests verts

### Item 1 — Matcher unifié `findExistingLoan(signals)` (commit 1)

**Files:**
- `backend/src/modules/loans/loans.service.ts` — ajouter `findExistingLoan()` + `MatchSignals` interface + `MatchResult` type. `findByIdentifiers` deviendra wrapper (rétro-compat tests existants).
- `backend/src/modules/loans/loans.service.spec.ts` — +6 specs.

**API:**
```typescript
export interface MatchSignals {
  contractRef?: string | null;
  rumNumber?: string | null;
  creditor?: string | null;
  monthlyAmount?: number | null;
  description?: string | null;
}
export interface MatchResult {
  loan: Loan;
  confidence: 'high' | 'medium' | 'low';
  reason: string; // ex: 'contractRef exact match'
}
async findExistingLoan(signals: MatchSignals): Promise<MatchResult | null>;
```

**Logique scoring:**
1. **high** : contractRef match (normalize tolérant) → return immédiat
2. **high** : rumNumber match dans rumRefs[] → return
3. **medium** : creditor exact (case-insensitive) + monthlyAmount ±5% → return
4. **low** : description regex match `loan.matchPattern` (si défini) + creditor probable → return
5. null sinon

**Pas casser:** `findByIdentifiers` continue d'exister, redéfinie pour appeler `findExistingLoan({accountNumber: contractRef, rumNumber}).then(r => r?.loan ?? null)`.

### Item 2 — `mergeLoanPatch` symétrique (commit 2)

**Files:**
- `backend/src/modules/loans/loans.service.ts` — ajouter helper privé statique `mergeLoanPatch(loan, patch, source)` + enum `LoanPatchSource = 'user' | 'amortization' | 'credit_statement' | 'bank_statement' | 'suggestion'`. Refactor `applyStatementSnapshot` et `applyAmortizationSchedule` pour déléguer. Tests cohérence ordres.

**Règles priorité (par champ):**
- `creditor`, `name`, `category`, `matchPattern` → user-only (apply* preserve si déjà set par user)
- `contractRef`, `rumRefs` → toute source peut ajouter, jamais écraser un user-set
- `startDate` → amortization > credit_statement > user-set (mais user peut éditer après)
- `endDate` → amortization > credit_statement
- `initialPrincipal` → amortization-only (classic), user-editable
- `monthlyPayment` → toute source peut update
- `usedAmount`, `maxAmount` → credit_statement-only (revolving)
- `amortizationSchedule` → amortization-only
- `lastStatementSnapshot` → credit_statement-only
- `taeg` → dans snapshot pour credit_statement, à hisser au top-level pour amortization (nouveau champ optionnel `Loan.taeg?: number | null`)

**Tests cohérence ordres:**
- import statement → puis import amortization → startDate vient de amortization (preserve si déjà set, mais cas vide = amortization écrit)
- import amortization → puis import statement → usedAmount apparaît, schedule conservé
- import statement → user édite name → puis import statement → name préservé

### Item 3 — `computeLoanState(loan, asOfDate?)` (commit 3)

**Files:**
- `backend/src/modules/loans/loans-state.helper.ts` (nouveau, fonction pure) — exporté.
- `backend/src/modules/loans/loans-state.helper.spec.ts` (nouveau).
- `frontend/src/components/loans/amortization-chart.tsx` — consomme `computeLoanState` côté frontend (helper miroir TypeScript en lib).
- `frontend/src/lib/loan-state.ts` (nouveau) — port frontend du helper, ou exposé via API enrichie.

**API:**
```typescript
interface LoanState {
  asOfDate: string;
  capitalRemaining: {
    plannedFromSchedule: number | null;        // null si pas de schedule
    estimatedFromOccurrences: number | null;   // initialPrincipal - sum(capitalPaid prorata)
    gap: number | null;                         // plannedFromSchedule - estimatedFromOccurrences
  };
  totalPaid: number;
  occurrencesCount: number;
  monthsActive: number;
  monthsRemaining: number | null; // null si pas d'endDate
}
export function computeLoanState(loan: Loan, asOfDate?: string): LoanState;
```

**Logique capital restant via schedule:**
Pour chaque occurrence à la date D, trouve la ligne `schedule[i]` du même mois → utilise `schedule[i].capitalPaid` (et non l'amount total). Sum cumul de capitalPaid jusqu'à asOfDate. `estimated = initialPrincipal - cumulCapitalPaid`. Si pas de schedule, fallback au calcul actuel naïf (avec un flag `confidence: 'low'`).

**Frontend:**
Soit on duplique le helper côté frontend (TypeScript pur), soit on expose `GET /api/loans/:id/state?asOf=YYYY-MM-DD` et le chart fetch. Plus pragmatique : helper TS pur dans `frontend/src/lib/loan-state.ts` qui consomme `Loan` typé.

### Item 4 — `ImportOrchestratorService` (commit 4)

**Files:**
- `backend/src/modules/loans/import-orchestrator.service.ts` (nouveau)
- `backend/src/modules/loans/import-orchestrator.service.spec.ts` (nouveau)
- `backend/src/modules/loans/loans.module.ts` — register
- `backend/src/modules/loans/loans.controller.ts` — refactor `importCreditStatementsAuto` + `importAmortization` pour appeler orchestrator
- `backend/src/modules/auto-sync/auto-sync.service.ts` — refactor `autoCreateLoansFromSuggestions` pour appeler orchestrator (`findOrCreate(signals, defaults)`)

**API:**
```typescript
class ImportOrchestratorService {
  async findOrCreate(signals: MatchSignals, defaultsForCreate: Partial<LoanInput>): Promise<{ loan: Loan; created: boolean; matchConfidence?: string }>;
  async applyCreditStatement(loanId: string, extracted: CreditStatementAnalysis): Promise<Loan>; // wraps applyStatementSnapshot
  async applyAmortization(loanId: string, extracted: AmortizationOutput): Promise<Loan>; // wraps applyAmortizationSchedule
}
```

**Behavior:**
- `findOrCreate` appelle `loans.findExistingLoan(signals)`. Si confidence ≥ 'medium' → return existant. Sinon → create avec defaults.
- Cohérence : tous les paths (controller credit, controller amortization, auto-sync suggestions) passent par `findOrCreate` au lieu de leurs propres heuristiques.

### Item 5 — Health badge UI (commit 5)

**Files:**
- `backend/src/modules/loans/loans.service.ts` — `getLoanHealth(loan)` retourne `'complete' | 'partial' | 'gap'`.
- `backend/src/modules/loans/loans.controller.ts` — `GET /api/loans` enrichit chaque loan avec `health: 'complete' | ...`.
- `backend/src/modules/loans/loans.service.spec.ts` — +3 specs sur getLoanHealth.
- `frontend/src/types/api.ts` — `Loan.health?: 'complete' | 'partial' | 'gap'` (server-computed).
- `frontend/src/components/loans/health-chip.tsx` (nouveau) — petit composant chip 🟢🟡🔴 avec tooltip.
- `frontend/src/components/loans/classic-card.tsx` + `revolving-card.tsx` — ajouter `<HealthChip loan={loan} />` à côté du nom.

**Heuristique health:**
- `complete` : (amortization OU lastStatementSnapshot ≤ 60 jours) ET (≥ 3 occurrences sur 6 derniers mois)
- `partial` : 1 ou 2 des 3 critères manquants
- `gap` : 0 statement récent ET ≤ 1 occurrence

### Item 6 — Cleanup pay-in-N rétrospectif (commit 6)

**Files:**
- `backend/src/modules/loans/loans.service.ts` — `getSuspiciousLoans()` détecte heuristique pay-in-N retrospective. Helper regex factorisé depuis `auto-sync.PAY_IN_N_PATTERN` → `loans-patterns.ts` (nouveau).
- `backend/src/modules/loans/loans.controller.ts` — `GET /api/loans/suspicious` + `POST /api/loans/cleanup-suspicious` (PinGuard + demo bypass) avec body `{ loanIds: string[] }` user-validated.
- `backend/src/modules/loans/loans.service.spec.ts` — +4 specs.
- `frontend/src/components/loans/suspicious-modal.tsx` (nouveau).
- `frontend/src/lib/queries.ts` — hooks `useSuspiciousLoans` + `useCleanupSuspiciousLoans`.
- `frontend/src/routes/loans.tsx` — bouton "Crédits suspects" à côté de "Doublons" si count > 0.

**Heuristique pay-in-N rétrospectif:**
1. `name` OU `matchPattern` match `PAY_IN_N_PATTERN`
2. OU : ≤ 4 occurrences distinctes ET sur ≤ 4 mois consécutifs ET pas d'occurrence depuis ≥ 60 jours
→ suspect.

## Documentation

`finance-tracker/CLAUDE.md` mis à jour avec section "Synchro crédits 3-sources" qui doc :
- Les 3 sources et qui peut écrire quoi
- Le tableau de priorité du `mergeLoanPatch`
- Les 3 chemins via `ImportOrchestratorService`
- Le health badge
- Le cleanup pay-in-N

## Order of execution

1 → 2 → 3 → 4 → 5 → 6 strictement séquentiel (chaque dépend du précédent partiellement).
- 1 : pas de dep. Création de `findExistingLoan` + tests.
- 2 : utilise rien de 1. Refactor des 2 apply*. Tests.
- 3 : pas de dep. Helper pur. Tests.
- 4 : utilise 1 (findExistingLoan) + 2 (apply* refactorés). Refactor 3 paths.
- 5 : pas de dep technique. Tests + frontend.
- 6 : utilise 1 (factorisation regex). Tests + frontend.

Build + tests verts à chaque commit. Deploy NAS après items 4 et 6 (frontend impact).

## Mapping AC → Files

| AC | Files principaux |
|---|---|
| AC1 (Item 1) | loans.service.ts, loans.service.spec.ts |
| AC2 (Item 2) | loans.service.ts, loans.service.spec.ts, loan.model.ts (taeg top-level) |
| AC3 (Item 3) | loans-state.helper.ts(.spec), amortization-chart.tsx, frontend/lib/loan-state.ts |
| AC4 (Item 4) | import-orchestrator.service.ts(.spec), loans.module.ts, loans.controller.ts, auto-sync.service.ts |
| AC5 (Item 5) | loans.service.ts, loans.controller.ts, types/api.ts, health-chip.tsx, classic-card.tsx, revolving-card.tsx |
| AC6 (Item 6) | loans-patterns.ts, loans.service.ts, loans.controller.ts, suspicious-modal.tsx, queries.ts, routes/loans.tsx |
| AC7 (tests verts) | toutes specs |
| AC8 (6 commits + deploy) | git workflow |

## Risks / Mitigations

- **Risk** : refactor `applyStatementSnapshot` breaks tests existants → **Mitigation** : tests existants restent identiques, seul l'implémentation change. Tests AC1-AC2 ajoutés en sus.
- **Risk** : ordre d'imports change le résultat (statement après amortization écrase qch) → **Mitigation** : tests cohérence ordres dans Item 2.
- **Risk** : Helper frontend dupliqué → désync avec backend → **Mitigation** : Item 3 helper pur sans dep, on duplique mais les tests des deux côtés assurent la même logique.
- **Risk** : `getLoanHealth` règle change avec usage → **Mitigation** : seuils en const exportées, faciles à tweaker.

→ Proceeding to execute phase…
