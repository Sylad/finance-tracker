# Step 01: Analyze

**Task:** Refonte synchro crédits 3-sources : matcher unifié + update partiel sym + computeLoanState + ImportOrchestrator + health badge + cleanup pay-in-N
**Started:** 2026-05-10T12:01:41Z

## Audit existant (capitalisé sur sessions RUM/dedupe/amortization + récap utilisateur)

### 3 sources de données pour un Loan

| Source | Endpoint | Service Claude | Champs Loan affectés |
|---|---|---|---|
| **Bank statement** (LBP) | `POST /api/analyze` | `AnthropicService.analyzeBankStatement` (suggestedRecurringExpenses[]) | `occurrencesDetected[]` via `auto-sync.syncLoans()` |
| **Credit statement** (Cofidis/Sofinco mensuel) | `POST /api/loans/import-credit-statements` | `CreditStatementService.analyzeCreditStatement` | `usedAmount`, `maxAmount`, `monthlyPayment`, `endDate`, `taeg`, `lastStatementSnapshot`, `creditor`, occurrence canonique du mois |
| **Tableau amortissement** (PDF banque initial) | `POST /api/loans/import-amortization` | `AmortizationService.analyzeAmortization` | `initialPrincipal`, `monthlyPayment`, `startDate`, `endDate`, `amortizationSchedule[]`, `creditor` |

### 7 chemins de création/update Loan

1. `loans.controller.create` — manuel (formulaire user)
2. `loans.controller.update` — manuel (formulaire user)
3. `loans.controller.importCreditStatementsAuto` — `findByIdentifiers` puis create+`applyStatementSnapshot`
4. `loans.controller.importAmortization` — `attachToLoanId` ? `applyAmortizationSchedule` : create+apply
5. `auto-sync.syncLoans` — match identifiers/regex puis `addOccurrence`
6. `auto-sync.autoCreateLoansFromSuggestions` — match heuristique creditor+amount puis `loans.create`
7. `loans.controller.split` — split revolving en sub-credits

### Inconsistances P1-P6

**P1. 2 algorithmes de matching différents**

| Algo | Lieu | Logique |
|---|---|---|
| `findByIdentifiers` | `loans.service.ts:448-475` | Normalize (lowercase + strip `\s\-`), substring tolérant 2 passes |
| `syncLoans matcher` | `auto-sync.service.ts:204-215` | OR-set lowercase contractRef+rumRefs, AND regex matchPattern, pas de strip |

**P2. 3 chemins de création non-coordonnés**

| Chemin | Anti-doublon |
|---|---|
| `importCreditStatementsAuto` | `findByIdentifiers({accountNumber, rumNumber})` |
| `importAmortization` | `attachToLoanId` query param uniquement |
| `autoCreateLoansFromSuggestions` | `existingLoans.some(l => sameAmount && (creditor exact OR name.includes(creditor)))` |

**P3. Update partiel asymétrique**

| Champ | applyStatementSnapshot | applyAmortizationSchedule |
|---|---|---|
| `creditor` | preserve si vide | preserve si vide |
| `startDate` | ❌ jamais | ✅ écrase |
| `endDate` | ✅ si classic et présent | ✅ écrase |
| `initialPrincipal` | ❌ | ✅ écrase |
| `monthlyPayment` | ✅ si > 0 | ✅ écrase |
| `usedAmount` | ✅ si revolving | ❌ |
| `maxAmount` | ✅ si revolving | ❌ |
| `taeg` | dans snapshot | ❌ pas stocké au top-level |
| `amortizationSchedule` | ❌ | ✅ écrase |
| `lastStatementSnapshot` | ✅ | ❌ |

**P4. Capital restant approximatif** — `AmortizationChart` calcule `initialPrincipal - sum(|occurrences|)`. Inclut intérêts → sous-estime.

**P5. Pas de health indicator** par crédit.

**P6. Pas de cleanup rétrospectif** des pay-in-N créés à tort avant `b8b0301`.

### Strong points à NE PAS casser

- Dedup `addOccurrence` Niveau 1+2 avec priorité source — robuste
- Whitelist `KNOWN_LOAN_CREDITORS` (ASF/ACPR) — correct
- Pay-in-N regex récente — à factoriser pour cleanup #6
- 137/137 backend tests — ne pas régresser
- PinGuard + DemoWriteGuard — conserver

## Acceptance Criteria

- [ ] AC1 (Item 1) : `findExistingLoan(signals)` méthode unique avec scoring confidence. ≥6 specs.
- [ ] AC2 (Item 2) : `mergeLoanPatch(loan, patch, source)` helper avec règles priorité. `applyStatementSnapshot` et `applyAmortizationSchedule` refactorent dessus. Tests cohérence ordres.
- [ ] AC3 (Item 3) : `computeLoanState(loan, asOfDate?)` exporté. `AmortizationChart` consomme. Tests unitaires pures.
- [ ] AC4 (Item 4) : `ImportOrchestratorService` centralise les 3 paths. `findExistingLoan` first-class.
- [ ] AC5 (Item 5) : `getLoanHealth(loan)` + endpoint enrichi + chip frontend.
- [ ] AC6 (Item 6) : `GET /api/loans/suspicious` + modal batch delete.
- [ ] AC7 : ≈170/170 tests verts.
- [ ] AC8 : 6 commits séparés, push origin/main, deploy NAS après items 4 et 6.

## Stats

- Files analyzed : 8
- Antipatterns détectés : 6 (P1-P6)
- Utilities à factoriser : pay-in-N regex, source enum, dedup priorité

→ Proceeding to planning phase…
