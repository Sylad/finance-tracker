# Finance Tracker — guide Claude Code

App perso de suivi financier perso : instance aux vraies données en local sur Big-Blue (`local/run.sh`), instance de démo sur le k3s de dark-blue (namespace `preprod`, https://finance.sladoire.dev). Frontend React + TanStack, backend NestJS, stockage JSON local.

## Architecture

| | |
|---|---|
| Backend | NestJS 11 sur port `3000`, préfixe `/api` |
| Frontend | React 18 + Vite + TanStack Router/Query sur port `4200` (nginx) |
| Stockage | JSON local dans `data/` (statements/, yearly/, uploads/, snapshots/) |
| Auth | PIN guard global (Bearer token) — toutes routes sauf `/health` et `/events` |
| AI | Anthropic SDK — modèle `claude-sonnet-4-5`, two-phase tool-use (extract_transactions → analyze_finances) |
| Live | Server-Sent Events sur `/api/events` (loans-changed, savings-changed, etc.) |

## Sessions et livraison (cadence)

- Début de session : skill `/cadence:session-start` (`cadence session start`) — faits,
  trois propositions du plan, puis attendre la priorité de Sylvain.
- Fin de session : skill `/cadence:session-close` (`cadence session close`, code 1 tant
  que ce n'est pas fermé), puis `cadence session next "…"` pour la suivante.
- Livraison : skill `/cadence:deliver`. Pousser, puis `cadence deliver --dry-run` et
  `cadence deliver` (`cadence.yaml`) : attente du run `build.yml` du sha poussé →
  `scripts/deploy.sh` bumpe dans `developpeur-gitops` le tag des **seuls** services
  construits par la CI (elle ne construit que le service modifié) et pousse → ArgoCD
  → `scripts/verify-rollout.sh` (pods sur les tags du values.yaml, `kubectl` lecture
  seule, contexte `dark-blue`) + `/api/health`. Jamais deux livraisons à la fois.
- L'instance déployée (finance.sladoire.dev, ns `preprod` de dark-blue) ne contient
  que des données de démo ; les vraies données restent en local sur Big-Blue.

## Plan (raf)

Le reste à faire vit dans `docs/plan/raf.yaml`, tenu par le CLI `raf`
([cadence](https://github.com/Sylad/cadence)). Chaque commit cite son lot dans
le message (`fix(L4): …`, `L2/t1`) ; `raf now` dit quoi faire ensuite,
`raf check` repère les commits sans lot et les lots oubliés, `raf gantt`
génère `docs/plan/gantt.html` (non versionné). Un lot se démarre
(`raf start L4`) avant le premier commit et se ferme (`raf done L4`) une fois
testé ; les décisions vont dans `raf note`.

**Revue UX obligatoire** (règle de Sylvain du 2026-09-28, tous les projets perso) : toute nouvelle
page ou modification d'écran est un lot `--visible`, revu par l'agent `cadence:ux-reviewer` (captures
1440 et 390 px, écarts fondés sur une règle nommée ou une mesure) avant `raf done`. Le verdict
s'enregistre avec `raf ux <lot> "…"`, sinon `raf done` refuse. Les lots « Revue UX — … » planifient
la revue de chaque écran existant ; les écarts trouvés deviennent des sous-tâches du lot.

## Nouveautés (cadence news)

Un lot qui change quelque chose **pour l'utilisateur** se crée avec
`raf add … --visible`. Avant ou juste après `raf done`, écrire son entrée :
`cadence news new L4` → `docs/nouveautes/<date>-<titre>.md` (texte pour
l'utilisateur, pas pour le développeur), déposer au moins une capture dans
`docs/nouveautes/captures/` et la déclarer sous `captures:` (ou
`nocapture: raison`). `raf check` échoue tant qu'un lot visible terminé n'a
pas son entrée. Puis `npm run news` régénère `frontend/public/nouveautes-data/`
(versionné : la CI n'a pas cadence), servi par la page `/nouveautes`.

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
- ✅ Mode démo : si `DEMO_FORCED_HOSTS` matche le host, le guard est bypassé ET le mode démo s'active (lecture seule, dataset isolé). Seul l’en-tête `Host` compte (jamais `X-Forwarded-Host`, forgeable) ; `DEMO_FORCED=true` force toute l’instance côté serveur — cf. `backend/src/modules/demo/forced-demo.ts` (L1). Voir `forced_demo_host_pattern.md` (mémoire user).

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
- Whitelist = liste UNIQUE des établissements de crédit `loans/credit-institutions.ts` (`CREDIT_INSTITUTIONS`, `isCreditInstitution`, `findCreditInstitution` ; L44, partagée avec `credit-detection`, grandes banques incluses pour leur crédit immobilier) — toute suggestion hors liste → pas d'auto-création.
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

**Exception : les remboursements anticipés (source `early_repayment`, 2026-09-12).** Un virement SORTANT vers le créancier ≥ max(3 × mensualité, 1 000 €) n'est pas une mensualité : il coexiste avec celle du mois (exempt de la dédup Niveau 2 dans les deux sens), décrémente `usedAmount` / 100 % capital, et est **exclu de tout calcul de « mensualité »** (compteurs, graphe charge mensuelle, moyennes). Identifiants contrat/RUM comparés via `normalizeIdentifier` (sans espaces/points/tirets) ; une tx qui porte l'identifiant d'un AUTRE crédit n'est jamais un match regex-only. Rejeu sur un relevé : `POST /api/auto-sync/statements/:id/replay` (idempotent). Vécu : 22 691 € de remboursements ignorés en août 2026.

### Revenu exceptionnel (2026-09-12)

Règle déterministe post-analyse (`analysis/exceptional-income.helper.ts`) : un crédit récurrent `salary` > **3 × médiane** des salaires des relevés précédents (≥ 2 mois) → la transaction porte `exceptionalAmount = montant − médiane`, le crédit récurrent retombe à la médiane. Score, détection de revenu santé et prévisions raisonnent sur `effectiveIncome(t)`. Rejeu sans Claude : `POST /api/statements/:id/exceptional-income`. Vécu : solde de tout compte de 37 k€ classé salaire récurrent (prévisions à 37 k€/mois).

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
- Conseils IA **locale** : Ollama local (RTX 5090), modèle `qwen3:32b` (bench 2026-08-12 vs gemma3:27b : meilleure fidélité chiffres + priorisation TAEG ; ~8 s à chaud, ~53 s à froid). Config `OLLAMA_ADVICE_BASE_URL`/`OLLAMA_ADVICE_MODEL` (défaut localhost:11434 — à surcharger si déploiement hors le PC dev). Fail-loud : Ollama down → HTTP 502 explicite, AUCUN fallback cloud.
- Frontend : page `/health` (bandeau verdict + 4 cartes + conseils + drawer seuils), tuile dashboard.
- Les virements vers l'épargne ne comptent pas dans les dépenses courantes du reste à vivre (décision 2026-08-12 : épargner ≠ consommer).

### Détection crédits & N× par LLM local (module `credit-detection/`, 2026-08-12)

- **Tri déterministe AVANT le LLM (L44, règles de Sylvain 2026-10-01, `credit-detection/deterministic-triage.ts`)** : (1) établissement de la liste partagée nommé par TOUS les libellés du cluster → `classic` (suggestion loan), ou `installment` si un libellé porte un indicateur de fractionné (`PAY_IN_N_PATTERN`, nombre lu dans « 4X ») ou si c'est une société BNPL (Klarna, Alma, Pledg) ; les grandes banques (crédit immobilier) ne comptent qu'avec un mot de crédit hors nom de la banque, « alma » qu'accolé à un indicateur, « paypal » seul hors liste ; (2) impôts/DGFIP, trésor public, amendes, loyer, URSSAF, retraits, virements sortants → exclus, jamais abonnement ; (3) ambigus → LLM : établissement mêlé à d'autres libellés, mot de crédit (PRET, MENSUALITE, CREDIT, EMPRUNT…) ou fractionné chez un non-listé, série non mensuelle ; (4) toute autre série mensuelle → `subscription` nommée d'après le libellé nettoyé (`subscriptionNameFromLabel`). Indicateurs de fractionné : `4X`, `4XCB`, `3 FOIS`… Mots de crédit : PRET, MENSUALITE, CREDIT, EMPRUNT, ECHEANCE PRET, LOA, LLD, REMBOURSEMENT. Un libellé d'allure bancaire (FINANC…, CONSUMER, BANK, BANQUE) non tranché par la liste part au LLM (libellés tronqués « CA CONSUMER FINANC »). Nom d'abonnement : processeur en tête (PayPal, Google, SumUp, SQ…) → marchand après « * » ; un cluster dont les libellés donnent plusieurs noms (ou aucun) part au LLM. Grande banque : `matchPattern` = `mortgageBankMatchPattern` (nom ET mot de crédit hors du nom, jamais CONSUMER / PERSONAL FINANCE), aussi pour l'auto-création d'auto-sync, qui exige le mot de crédit dans le libellé. La classification de règle (confidence 1) passe par le même validateur. Le 502 « Ollama indisponible » reste réservé au cas où aucun cluster n'a pu être traité.
- **Trois verrous** : clustering déterministe (par créancier|marchand, sous-séries de montants ±5 %) → tri déterministe, puis classification qwen3:32b local (`OLLAMA_DETECTION_MODEL`) pour les seuls ambigus → validateur déterministe (espacement mensuel, 1/mois, garde créancier existant fuzzy, séries ≥6 occ stables → subscription) → SUGGESTIONS uniquement (bandeau /loans), jamais de création directe.
- **Gardes du validateur (2026-10-01, revue 2026-08-13 #2 #3)** : les gardes « créancier existant » (fuzzy + `findExistingLoan`) testent le creditor LLM (containment fuzzy) **et** `cluster.creditor` déterministe — premier mot du libellé, donc comparé par MOT ENTIER si ≥ 4 caractères, sinon égalité stricte, mots génériques (`permanent`, `pour`…) ignorés. Une suggestion `subscription` est validée PAR SOUS-SÉRIE de montant (`splitByAmount` ±5 %, comme installment : une suggestion par sous-série valide, label suffixé du montant) et exige fraîcheur (`series_ended` > 60 j, par sous-série : ancien tarif ou option résiliée jamais suggérés) + ≥ 2 mois distincts + espacement mensuel (`checkIntervals`). Montant suffixé au libellé seulement si plus d'une sous-série est ÉMISE. Repli montant variable (énergie, conso) : si AUCUNE sous-série n'est émise, une seule série est validée — occurrences postérieures à la dernière sous-série morte (ancien tarif exclu de la médiane), sinon tout le cluster — montant médian, libellé sans suffixe ; pas de repli si une sous-série a été bloquée par l'anti-re-suggestion. Depuis L44, `upsertMany` dédupe les suggestions `subscription` par creditor + montant ±5 % : chaque sous-série émise persiste sa suggestion. Une suggestion `subscription` n'est pas proposée si un abonnement suivi (creditor ou nom) ou une suggestion `rejected`/`snoozed` matche en fuzzy à ±5 % (`existing_subscription`, `subscription_already_dismissed`) — série longue reroutée comprise. Depuis L44 (ex-L43), la même anti-re-suggestion bloque aussi les branches installment et classic/revolving (`loan_already_dismissed`). Seuls les choix de l'UTILISATEUR bloquent : `rejected`, ou `snoozed` avec `resolvedBy: 'user'` — les reports d'auto-sync (`snooze(id, 'auto')`) et les reports historiques sans `resolvedBy` ne bloquent pas (sinon l'échéancier N× de la détection n'était plus fusionné).
- **Exception privacy documentée** : les libellés de transactions partent au LLM de détection — acceptable car strictement local (jamais de fallback cloud). Le module conseils santé reste agrégats-only.
- Endpoints : `POST /api/credit-detection/scan` (bouton /loans, ~2 min) + hook post-import fire-and-forget (résultat dans l import-log). Erreurs par cluster agrégées dans `errors[]` — un Ollama up-mais-cassé donne 200 avec erreurs, l UI les affiche.
- Accept d une suggestion N× : `POST /api/loan-suggestions/:id/accept-installment` → loan kind=installment avec échéancier reconstruit (occurrences seedées, paidOccurrenceId réels).
- Dédup suggestions : par creditor, sauf suggestions installment → creditor+montant arrondi (plusieurs plans simultanés du même créancier coexistent) et suggestions subscription (des deux côtés) → creditor APPROXIMATIF (suite de mots de l'un dans l'autre, sans .com/SAS…) + montant ±5 % (L44 : deux abonnements d'un même opérateur coexistent ; une hausse > 5 % est une nouvelle suggestion, même si l'ancien tarif a été refusé).
- Diagnostic santé : « opérations neutres » (paire entrée/sortie même montant ≤7 j, hors créanciers/épargne) exclues des dépenses courantes (`details.operationsNeutres`).

### Two-phase tool-use Claude
- Phase 1 = `extract_transactions`, Phase 2 = `analyze_finances`. **Toujours vérifier que phase 1 a retourné > 0 transactions** avant de lancer phase 2 — sinon plantage.
- `tool_choice: { type: 'tool' }` strict, donc `ANALYZE_TOOL.description` peut rester en EN (pas de risque pratique).

### Cache JSON après schema change
- Si un module backend ajoute un champ, le cache JSON existant ne contient pas ce champ → re-fetch peut renvoyer des objets incomplets. **Buster le cache** (suppression du fichier ou bump version) avant rebuild backend.

### Emplacements
- Sources : `~/projects/developpeur/finance-tracker` (Big-Blue). Données réelles : `data/` (`local/run.sh`) ou `data-local/` (`docker-compose.local.yml`), jamais versionnées.
- Prod démo : chart `developpeur-gitops/charts/finance-tracker`, PVC `finance-backend-data` (ns `preprod`).
