# Review 2026-08-13 — findings reportés (non corrigés dans cette passe)

Revue 8 angles sur `backend/src` (+ contrats frontend). ~44 candidats, 26 corrigés
(commit associé). Ci-dessous ce qui reste, trié par valeur. Vérifié dans le code
au moment de la revue — re-vérifier avant d'attaquer.

## Correctness / sécurité

1. **claude-usage hors isolation démo + X-Forwarded-Host spoofable** — `ClaudeUsageService`
   construit ses chemins hors `RequestDataDirService` : un visiteur en mode démo (ou un
   client LAN qui spoofe `X-Forwarded-Host: *.trycloudflare.com` pour bypasser le PIN)
   lit/écrit le VRAI `claude-shared.json` (`PUT /api/claude/balance`). Fix : router les
   paths via dataDir (démo → copie démo) ; évaluer un trust-proxy pour le header.
2. **Garde-fous du validateur détection keyés sur le creditor LLM** — `detection-validator`
   compare `classification.creditor` (sortie qwen3) aux loans existants ; une divergence
   d'alias (SOFINCO vs CA CONSUMER FINANCE) bypasse le fuzzy guard → suggestion doublon.
   Fix : croiser AUSSI `cluster.creditor` déterministe dans les deux gardes.
3. **Branche subscription du validateur sans déterminisme** — 2 occurrences à 4 jours
   d'écart peuvent devenir une suggestion « subscription ». Fix : exiger ≥2 mois distincts
   + espacement ~mensuel, et un garde anti-re-suggestion (équivalent subscriptions de
   `hasFuzzyKnownLoanPayment`).
4. **`mergeDuplicates` ne dédupe pas par mois calendaire** — le merge peut produire un
   canonical avec 2 débits le même mois (bank + credit_statement) et perdre `usedAmount`
   si le canonical choisi n'en a pas. Fix : dédup mensuelle par priorité de source au
   merge + préférer le porteur d'encours.
5. **Scans détection concurrents** — `triggerDetection` fire-and-forget par fichier ×
   upload 12 PDFs = read-modify-write concurrents sur suggestions/loans (lost updates).
   Fix : mutex/skip-si-scan-en-cours dans `CreditDetectionService`.
6. **`maybeAddInterest` en replay** — intérêts estimés calculés sur `currentBalance`
   ACTUEL lors du replay d'un vieux relevé (P2/P3). Fix : ne jamais estimer en replay,
   ou baser sur le solde à la date du statement.
7. **Paires neutres intra-relevé seulement côté /expenses** — une paire à cheval sur
   2 mois est neutre pour /health mais pas pour /expenses. Fix : fenêtre 2 relevés dans
   `findNeutralOutgoingTxIds` (charger le relevé adjacent).
8. **`paidOccurrenceId` : 3 formats selon le writer** — occurrence UUID (contrat),
   transactionId (`retroMatchInstallment`), statementId (`convertToInstallment`).
   Fix : normaliser sur l'UUID d'occurrence partout.
9. **`numberLike` et milliers à la française** — `"3.000"` → 3 (silencieux). Fix :
   preprocess qui détecte `^\d{1,3}(\.\d{3})+$` comme séparateurs de milliers.
10. **`getLoanHealth` fraîcheur sur date d'import** — utilise `lastStatementSnapshot.date`
    (import) au lieu de `statementDate` : importer un PDF d'il y a un an rend le loan
    « complete ».
11. **`upsertFromBankExtract` month-end en UTC** — `toISOString()` décale d'un jour en
    CET/CEST (même bug déjà corrigé dans `getBalanceHistory`). Fix : composer la date
    en local.
12. **`amortization` budget 16k sans retry** — un plan immo 300+ lignes échoue
    définitivement. Fix : retry à 64k comme le flux bancaire.
13. **claude-usage cross-process lost updates** — partagé entre 3 apps NAS sans verrou
    fichier. Connu/documenté ; accepter ou lockfile.

## Perf / architecture (gains réels, risque moyen)

14. **`LoansService` sans cache** — chaque `getAll` relit tout loans.json ; replay =
    250+ cycles read+write. Fix : cache type `StorageService.cacheByDir` + batching des
    occurrences par statement (le contrat `mergeLoanPatch` « ne persiste pas » existe déjà).
15. **Scan détection relit loans.json 2×/cluster** — passer le tableau de loans une fois
    en début de scan aux gardes du validateur.
16. **`syncInstallmentLoan` 5 passes fichier/ligne** — `addOccurrence` retourne déjà le
    loan muté, le `getOne` de relecture est redondant ; appliquer occurrences + paid en
    un seul read-modify-write.
17. **`replayAll`/`rescoreAll` dupliqués dans 2 controllers** (déjà driftés) + PATCH par
    transaction avec `replayAll: true` depuis auto-categorize-modal = N replays complets.
    Fix : `CategoryRulesService.replayAll()` unique + un seul replay par lot accepté.
18. **`triggerDetection` copié-collé** entre analysis.controller et statements.controller
    → `CreditDetectionService.scanInBackground(statement)`.
19. **Boucle d'import crédit dupliquée** entre les 2 endpoints loans (occurrence canonique,
    documentType) → descendre dans `ImportOrchestratorService`.

## Hygiène

20. **Helpers dupliqués** — `round2` ×6, slugify/norm ×5 (2 comportements !),
    `normalizeAccountNumber` ×2, clustering ±5 % ×2, paires neutres ×2, clé YYYY-MM
    re-dérivée ×8. Créer `common/{money,slugify,month-key,amount-clustering,neutral-pairs}`.
21. **`findByIdentifiers`** appelé uniquement par ses specs — re-cibler les tests sur
    `findExistingLoan` et supprimer.
22. **SSE sans consommateur** — soit brancher un `EventSource` → invalidations TanStack
    (pattern déjà en mémoire), soit supprimer la chaîne d'events côté backend.
23. **`isQuotaError` heuristique `msg.includes('credit')`** — peut classer un APIError
    quelconque en 402.
