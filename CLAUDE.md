# Finance Tracker — guide Claude Code

App perso de suivi financier perso, déployée sur NAS Synology. Frontend React + TanStack, backend NestJS, stockage JSON local.

## Architecture

| | |
|---|---|
| Backend | NestJS 11 sur port `3000`, préfixe `/api` |
| Frontend | React 18 + Vite + TanStack Router/Query sur port `4200` (nginx) |
| Stockage | JSON local dans `data/` (statements/, yearly/, uploads/, snapshots/) |
| Auth | PIN guard global (Bearer token) — toutes routes sauf `/health` et `/events` |
| AI | Anthropic SDK — modèle `claude-sonnet-4-5`, two-phase tool-use (extract_transactions → analyze_finances) |
| Live | Server-Sent Events sur `/api/events` (claude-balance-changed, etc.) |

## Workflow dev

Les builds se font via Docker compose côté NAS (sources sync via `scp -O` depuis WSL) :

```bash
ssh nas "cd /volume2/docker/developpeur/finance-tracker && docker compose up -d --build finance-frontend"
```

Pour le backend : remplace `finance-frontend` par `finance-backend`.

## Variables d'env requises (`backend/.env`)

```
APP_PIN=0000                  # PIN d'auth (4-8 chiffres)
ANTHROPIC_API_KEY=sk-ant-...
DATA_DIR=/app/data
UPLOAD_DIR=/app/data/uploads
CORS_ORIGIN=http://localhost:4200
```

## Conventions code

- Frontend : React 18, TypeScript strict, TanStack Router code-based (pas de file-based routing), TanStack Query pour data fetching, Tailwind CSS + tokens HSL custom (slate + emerald).
- Backend : NestJS modules dans `src/modules/{feature}/`, services + controllers + DTOs.
- Stockage : `StorageService` lit/écrit JSON avec snapshots automatiques avant écriture. Les bilans annuels s'archivent automatiquement le 1er janvier (mois passés déplacés dans `statements/archive/`).

## Pièges connus

- **Cache JSON après schema change** : si un module backend ajoute un champ, le cache JSON existant ne contient pas ce champ → re-fetch peut renvoyer des objets incomplets. Buster en supprimant le cache avant rebuild.
- **PIN guard** : le frontend stocke le PIN en `localStorage`, ajouté en header `Authorization: Bearer <pin>` automatiquement. La route `/budgets` est utilisée comme test de validité au login.
- **Two-phase tool-use** : si la phase 1 retourne 0 transactions extraites, la phase 2 plante. Toujours vérifier le retour de phase 1 avant phase 2.

## Stack précise

- React 18.3 · Vite 5 · TanStack Router 1.78 · TanStack Query 5.59 · Recharts 2.13 · Tailwind 3.4 · Lucide
- NestJS 11 · Anthropic SDK 0.91 · multer 2 · uuid 14
- Docker multi-stage (`node:20-alpine` builder → `nginx:alpine` runtime côté frontend)

## Règles projet (durables)

### Données réelles
- ❌ **JAMAIS de vraies transactions** dans les fixtures, seeds, snapshots de tests, ou dataset démo. Le dataset démo (`/api/demo`) est synthétique : 6 statements (Oct 2025 → Mar 2026), 6 crédits fictifs, 2 épargnes fictives, 4 suggestions.
- ❌ Ne pas commit le contenu de `data/finance/` ni de `uploads/`. C'est dans `.gitignore` et ça doit y rester.

### PIN guard
- ✅ Tout nouvel endpoint **write** (POST/PUT/PATCH/DELETE) doit passer par `PinGuard`. Le guard est global au module racine via `APP_GUARD` ; vérifier que l'endpoint n'est pas dans la whitelist (`/health`, `/events`).
- ✅ Ajouter un test PIN guard sur le endpoint avant de merger. Pattern existant dans `pin.guard.spec.ts`.
- ✅ Mode démo : si `DEMO_FORCED_HOSTS` matche le host, le guard est bypassé ET le mode démo s'active (lecture seule, dataset isolé). Voir `forced_demo_host_pattern.md` (mémoire user).

### Convention nom PDF LBP
- Les PDFs LBP sont nommés `releve_..._YYYYMMDD.pdf` où `YYYYMMDD` est la **date d'émission** (~9 du mois suivant), **pas la période**.
- ✅ Le relevé du mois M est dispo le ~9 de M+1. Si user dit "le mois X manque", vérifier d'abord que le PDF émis le 9 de X+1 existe.
- ❌ Ne PAS utiliser `extractMonthFromFilename` pour deviner la période — il ne reconnaît plus que le pattern `YYYY-MM` explicite (avec tiret) depuis 2026-04-28.
- ✅ La période est dérivée du **mode des dates de transactions** côté backend (`derivePeriodFromTransactions` dans `anthropic.service.ts`), via **unique-day count** (pas tx count) pour gérer le straddle de mois LBP.

### Archivage relevés
- Relevés d'années passées **déplacés** (pas supprimés) dans `data/finance/statements/archive/<YYYY>/<YYYY-MM>.json`.
- `getAllStatements()` ne lit que la racine — comportement souhaité, l'archive n'est pas exposée par défaut.
- Yearly summary `data/finance/yearly/<YYYY>.json` régénéré depuis TOUS les fichiers de `archive/<YYYY>/` à chaque archivage. Ne pas régresser cette logique.

### Détection sub-credits (loans.service)
Pour découper un crédit revolving en sub-credits :
- Filtrer **débits uniquement**, regex référence `\b\d{8,}\b` qui revient ≥ 2 fois.
- Cluster par montant **±5 %**.
- Garder un cluster seulement si : **≥ 3 mois distincts**, ≤ 1 occurrence/mois en moyenne. Si montant < 30€ → seuil monté à **≥ 4 mois distincts** (sinon les abos polluent).
- Sans ces filtres, un Carrefour Banque se découpe en 48 faux sub-credits.

### Auto-création depuis suggestions Claude
- Whitelist `KNOWN_LOAN_CREDITORS` dans `auto-sync.service` — toute suggestion hors liste → snooze auto, pas de création.
- Regex `NOT_A_CREDIT` exclut `\b(COMPTANT|PAIEMENT CB|ACHAT CB|CB CARREFOUR|RETRAIT)\b` même si la regex de matching est large.
- **Matcher standard (`syncStandardLoan`, revu 2026-08-12)** : les identifiants (`contractRef`/`rumRefs`) sont un signal de **renfort, pas une condition** — les libellés bancaires LBP ne portent jamais la référence contrat ("Prélèvement Floa"). L'ancien matcher AND (identifier ET regex) rendait le matching bancaire impossible pour tout loan enrichi depuis un relevé de crédit → 0 occurrence → désactivation massive par `autoDeactivateStaleLoans` (incident 2026-08-12 : 26 800 € d'encours revolving disparus du dashboard en un import). L'ambiguïté multi-crédits même créancier (raison d'être du AND) est résolue par : **débits uniquement** (`amount < 0` — un virement entrant décrémenterait `usedAmount`), **1 occurrence max/mois calendaire** (la plus proche du `monthlyPayment`, mois déjà couverts par une occurrence existante skippés pour l'idempotence au re-run), **cross-loan dedup** (`allocatedTxIds` : 1 tx bancaire ↔ 1 loan).
- **Garde-fou désactivation** : `autoDeactivateStaleLoans` ne désactive JAMAIS un revolving avec `usedAmount > 0` (un encours non soldé ≠ crédit terminé ; c'est presque toujours le matcher qui n'a pas trouvé les prélèvements). Log warn + conservé actif.
- Libellés bancaires SOFINCO : les prélèvements apparaissent sous « CA Consumer Finance » (Sofinco = marque CACF) → `matchPattern` des loans SOFINCO = `SOFINCO|CA\s+CONSUMER`.
- **Tirages (draws, 2026-08-12)** : un virement ENTRANT (`amount > 0`) dont le libellé matche un revolving actif = tirage sur la réserve → occurrence `source: 'draw'` qui **augmente** `usedAmount` (`syncDraws` dans auto-sync). Règle métier (Sylvain) : seules les réserves renouvelables produisent des lignes positives, les crédits classiques ne font que des retraits. Garde-fous : tirage daté ≤ `statementDate` du dernier relevé de crédit ignoré (déjà dans le solde de baseline) ; si plusieurs réserves du même créancier matchent (2 SOFINCO), affectation à la plus grande marge sous plafond + warn — le total reste juste, le relevé de crédit suivant recale la répartition. Les tirages ne sont PAS soumis à l'invariant 1 débit/mois (dédup mensuelle et `detectDuplicates` filtrent `amount < 0`).
- Filtre `PAY_IN_N_PATTERN` (loans/loans-patterns.ts) exclut les paiements échelonnés 2-4 fois (4X CB / FacilyPay / KLARNA 4X / ALMA 3X / PAY LATER) — snooze sans création. Seuil min `MIN_OCCURRENCES_AUTO_CREATE = 5` cumulées.

### Invariant métier "1 débit/mois max par crédit" (APEX 06 — 2026-05-10)

Règle first-class : **un crédit (classic, revolving, installment) n'est JAMAIS débité plus d'une fois par mois calendaire**. Cet invariant est appliqué partout où il a un sens :

- **`addOccurrence`** dédupe par mois (Niveau 2) — garde l'occurrence de plus haute priorité (credit_statement > bank_statement > manual).
- **`detectDuplicates`** : 2 loans actifs partageant ≥1 mois d'occurrence calendaire = forcément doublon (signal `sharesMonth`). S'ajoute au critère mensualité ±5%.
- **`getSuspiciousLoans` critère 3** : un loan actif (classic/revolving) avec `startDate ≤ lastStatementDate` et **aucune occurrence dans le dernier relevé** est suspect → soit terminé, soit doublon. Reason `Absent du dernier relevé` exposé dans la modal Suspects.
- **Reset propre** : `POST /api/auto-sync/reset-loans` purge tous les loans + reset toutes les suggestions à `pending`, replay `autoCreateLoansFromSuggestions` puis `syncLoans` sur les relevés existants. Bouton "Reset" (orange) sur `/loans`. Permet de repartir d'une base saine sans re-uploader les PDFs.

Anti-pattern à NE PAS reproduire : empiler des heuristiques (regex pay-in-N, seuil min occurrences, whitelist creditors) à chaque doublon découvert. Si un doublon apparaît, demander : "y a-t-il une règle métier simple qui éliminerait ce bug à la source ?"

### Synchro robuste 3-sources (APEX 04 — refonte 2026-05-10, étendue APEX 05)

L'app croise 3 sources de données pour un crédit (relevé bancaire, relevé crédit, tableau d'amortissement, contrat installment N×). Pour éviter incohérences/doublons, tout passe par des helpers unifiés :

**Modèle Loan : 3 kinds.** Champ `kind: 'classic' | 'revolving' | 'installment'` (fallback sur `type` pour les loans pré-APEX 05). Le kind détermine la stratégie de matching/synchro :
- `classic` : tableau d'amortissement + mensualités fixes, durée connue
- `revolving` : carte de crédit renouvelable, balance qui varie, occurrences mensuelles
- `installment` : paiement N fois (Cofidis 4XCB, Alma 4X, Klarna 3X, FacilyPay…) avec `installmentSchedule[]` ({dueDate, amount, paid, paidOccurrenceId?}). Échéancier extrait directement du contrat 4XCB au moment de l'import (toutes les dates calculées depuis `signatureDate + delta`).

**1. `findExistingLoan(signals)`** dans `loans.service.ts` — matcher unique avec scoring confidence :
| Confidence | Critère |
|---|---|
| `high` | contractRef match tolérant (lowercase + strip espaces/tirets, substring) |
| `high` | rumNumber match dans rumRefs[] |
| `medium` | creditor exact + monthlyAmount ±5% |
| `low` | description regex match loan.matchPattern |

**2. `mergeLoanPatch(loan, patch, source)`** static, règles priorité par champ :

Priorité sources : `user > amortization > credit_statement > bank_statement > suggestion`.

| Champ | Règle |
|---|---|
| `creditor`, `contractRef` | Preserve user-set, auto-fill si vide. |
| `rumRefs[]` | **Additif** (union dédup-normalisée), jamais écrase. |
| `startDate` | amortization gagne canonical, credit_statement auto-fill si vide. |
| `endDate` | amortization > credit_statement, user override. |
| `initialPrincipal`, `amortizationSchedule` | amortization-only. |
| `monthlyPayment`, `taeg` | toute source non-revolving. |
| `maxAmount`, `usedAmount` | credit_statement-only (revolving). |
| `lastStatementSnapshot` | credit_statement-only. |

**3. `ImportOrchestratorService`** (loans/import-orchestrator.service.ts) — point d'entrée unique pour les 3 paths d'import. Tous appellent `findExistingLoan` AVANT de créer un loan, puis `applyStatementSnapshot` ou `applyAmortizationSchedule` qui délègue à `mergeLoanPatch`.

**4. `computeLoanState(loan, asOfDate?)`** (loans/loans-state.helper.ts + frontend miroir lib/loan-state.ts) — calcul exact du capital restant en alignant chaque occurrence sur la portion `capitalPaid` de la ligne schedule du même mois (vs naïf qui inclut intérêts).

**5. `getLoanHealth(loan)`** + chip 🟢🟡🔴 sur les cards :
- **complete** : amortization OU statement récent (≤60j) ET ≥3 occurrences sur 6 derniers mois
- **partial** : 1-2 critères manquants
- **gap** : 0 statement récent ET ≤1 occurrence

**6. Cleanup pay-in-N rétrospectif** : `GET /api/loans/suspicious` + bouton "Suspects" sur `/loans` détectent les loans probablement créés à tort (≤4 occurrences sur ≤4 mois consécutifs et arrêtés ≥60j, OU name match `PAY_IN_N_PATTERN`). Deux actions : suppression bulk OU **conversion en `kind='installment'`** via `POST /api/loans/:id/convert-to-installment` (reconstruit `installmentSchedule[]` depuis les occurrences détectées). Les `kind='installment'` sont skip de la détection suspect (légitimes par construction).

**7. Import contrat installment** (APEX 05) : `CreditStatementService` distingue désormais "contrat de paiement en N fois" (`installmentDetails != null`) vs relevé mensuel revolving. Le tool Claude retourne l'échéancier complet (`count`, `amount`, `installments[]`, `merchant`, `signatureDate`, `totalAmount`). `ImportOrchestratorService.importInstallmentContract()` crée un Loan `kind='installment'` avec `installmentSchedule[]` directement depuis les dates calculées.

**8. Matcher installment dans `auto-sync`** : pour `kind='installment'`, `syncInstallmentLoan()` parcourt chaque ligne non payée et cherche dans le statement courant une transaction (date ±3j de `dueDate`, amount ±0.50€, creditor pattern). Match exact → `markInstallmentPaid(loanId, lineIndex, paidOccurrenceId)` (idempotent). Aucun risque de doublon/auto-création comme pour `classic`/`revolving`.

Doc complète dans `.claude/output/apex/04-loans-synchro-robust/` et `.claude/output/apex/05-loans-installment-kind/`.

### Santé financière (module `health/`, 2026-08-12)

- **Les chiffres en code, les mots au LLM** : le verdict (rouge/orange/vert) et les 4 blocs (reste à vivre, charge dette, flux tirages, trajectoire) sont calculés par `HealthService` (déterministe, testé). Le LLM ne fait QUE rédiger les conseils depuis des agrégats — jamais de calcul, jamais de libellé de transaction ni `income.label` dans le prompt (test sentinelle le verrouille).
- Endpoints : `GET /api/health-check/diagnostic` · `GET/PUT /api/health-check/thresholds` + `POST .../reset` · `POST/GET /api/health-check/advice`. Le `/api/health` technique (health-status.controller) est distinct — ne pas le toucher.
- Revenus : détection générique par cluster stable ≥ 3 mois hors tirages (`income-detection.helper.ts`) — aucun nom d'employeur en dur ; override manuel `manualMonthlyIncome` dans les seuils prime sur tout.
- Conseils IA **locale** : Ollama Big-Blue (RTX 5090), modèle `qwen3:32b` (bench 2026-08-12 vs gemma3:27b : meilleure fidélité chiffres + priorisation TAEG ; ~8 s à chaud, ~53 s à froid). Config `OLLAMA_ADVICE_BASE_URL`/`OLLAMA_ADVICE_MODEL` (défaut localhost:11434 — à surcharger si déploiement hors Big-Blue). Fail-loud : Ollama down → HTTP 502 explicite, AUCUN fallback cloud.
- Frontend : page `/health` (bandeau verdict + 4 cartes + conseils + drawer seuils), tuile dashboard.
- Les virements vers l'épargne ne comptent pas dans les dépenses courantes du reste à vivre (décision 2026-08-12 : épargner ≠ consommer).

### Détection crédits & N× par LLM local (module `credit-detection/`, 2026-08-12)

- **Trois verrous** : clustering déterministe (par créancier|marchand, sous-séries de montants ±5 %) → classification qwen3:32b local (`OLLAMA_DETECTION_MODEL`) → validateur déterministe (espacement mensuel, 1/mois, garde créancier existant fuzzy, séries ≥6 occ stables → subscription) → SUGGESTIONS uniquement (bandeau /loans), jamais de création directe.
- **Exception privacy documentée** : les libellés de transactions partent au LLM de détection — acceptable car strictement local (jamais de fallback cloud). Le module conseils santé reste agrégats-only.
- Endpoints : `POST /api/credit-detection/scan` (bouton /loans, ~2 min) + hook post-import fire-and-forget (résultat dans l import-log). Erreurs par cluster agrégées dans `errors[]` — un Ollama up-mais-cassé donne 200 avec erreurs, l UI les affiche.
- Accept d une suggestion N× : `POST /api/loan-suggestions/:id/accept-installment` → loan kind=installment avec échéancier reconstruit (occurrences seedées, paidOccurrenceId réels).
- Dédup suggestions : par creditor, sauf suggestions installment → creditor+montant arrondi (plusieurs plans simultanés du même créancier coexistent). Limitation connue : plusieurs séries longues du même créancier routées en subscription se dédupliquent par creditor (1 seule survit).
- Diagnostic santé : « opérations neutres » (paire entrée/sortie même montant ≤7 j, hors créanciers/épargne) exclues des dépenses courantes (`details.operationsNeutres`).

### Two-phase tool-use Claude
- Phase 1 = `extract_transactions`, Phase 2 = `analyze_finances`. **Toujours vérifier que phase 1 a retourné > 0 transactions** avant de lancer phase 2 — sinon plantage.
- `tool_choice: { type: 'tool' }` strict, donc `ANALYZE_TOOL.description` peut rester en EN (pas de risque pratique).

### Cache JSON après schema change
- Si un module backend ajoute un champ, le cache JSON existant ne contient pas ce champ → re-fetch peut renvoyer des objets incomplets. **Buster le cache** (suppression du fichier ou bump version) avant rebuild backend.

### Path NAS
- Container path **`/volume2/docker/developpeur/finance-tracker-v2/`** (note : `-v2` sur le NAS, repo GitHub et WSL = `finance-tracker` sans suffixe).
