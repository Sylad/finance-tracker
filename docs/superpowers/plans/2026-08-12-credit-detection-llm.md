# Détection crédits/N× LLM local + opérations neutres — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Détecter les crédits et paiements en plusieurs fois (PayPal 4×, Klarna 3×, Alma…) via clustering déterministe + classification qwen3:32b local + validateur code → suggestions à valider ; et neutraliser les paires pass-through dans le diagnostic santé.

**Architecture:** Nouveau module NestJS `credit-detection/` en 3 services (clustering → classifier LLM → validateur), branché sur le système de suggestions existant. Le LLM ne crée jamais rien. Règle « opérations neutres » ajoutée à `HealthService.computeResteAVivre`. Spec source : `docs/superpowers/specs/2026-08-12-credit-detection-llm-design.md`.

**Tech Stack:** NestJS 11, Jest, Ollama `/api/generate` format json (pattern `health-advice.service.ts`), React 18 + TanStack (frontend), vitest.

## Global Constraints

- Le LLM ne crée JAMAIS un loan/subscription directement — uniquement des suggestions (bandeau `/loans`). Trois verrous : LLM → validateur déterministe → validation humaine.
- Exception privacy documentée : les LIBELLÉS partent au LLM de détection (indispensable, local-only). Commentaire en tête de `credit-classifier.service.ts` + section CLAUDE.md (Task 8).
- Fail-loud agrégé : erreurs par cluster comptées et exposées (`errors[]`), jamais avalées ; Ollama down sur `/scan` → 502 ; sur post-import → import OK + ligne d'échec import-log. AUCUN fallback cloud.
- Seuil de confiance : `confidence < 0.6` → ignoré (loggé debug).
- Fixtures synthétiques uniquement (jamais les vraies données de Sylvain dans les tests).
- Tests : `cd backend && npx jest src/modules/credit-detection` + suite complète verte (275 backend / 57 frontend avant ce chantier). Frontend : `npx tsc --noEmit` + `npm run test`.
- Commits `feat(detection): …` / `feat(health): …`, footer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Config : `OLLAMA_DETECTION_MODEL` (défaut `qwen3:32b`), base URL réutilise `ollamaAdviceBaseUrl` existant.

---

### Task 1: Types + CandidateClusteringService

**Files:**
- Create: `backend/src/models/credit-detection.model.ts`
- Create: `backend/src/modules/credit-detection/candidate-clustering.service.ts`
- Create: `backend/src/modules/credit-detection/credit-detection.module.ts` (squelette : provider clustering seulement)
- Modify: `backend/src/app.module.ts` (ajouter `CreditDetectionModule`)
- Test: `backend/src/modules/credit-detection/candidate-clustering.service.spec.ts`

**Interfaces:**
- Consumes: `MonthlyStatement`, `Loan`, `Subscription` (modèles existants).
- Produces (consommé par Tasks 2-3-5) :

```ts
// backend/src/models/credit-detection.model.ts
export interface ClusterOccurrence {
  date: string;           // YYYY-MM-DD
  amount: number;         // négatif (débit)
  description: string;
  transactionId: string;
  statementId: string;
}

export interface CandidateCluster {
  key: string;            // clé normalisée
  creditor: string;       // ex 'klarna', 'paypal'
  merchant: string | null; // ex 'zalando', 'joytoy'
  occurrences: ClusterOccurrence[]; // triées par date croissante
}

export type DetectionClass = 'installment' | 'revolving' | 'classic' | 'subscription' | 'not_credit';

export interface ClusterClassification {
  classification: DetectionClass;
  creditor: string;
  merchant: string | null;
  installmentCount: number | null;
  confidence: number;     // 0-1
  rationale: string;
}

export interface DetectionScanResult {
  clustersAnalyzed: number;
  suggestionsCreated: number;
  errors: { clusterKey: string; message: string }[];
}
```

- `CandidateClusteringService.buildClusters(statements: MonthlyStatement[], excludedTxIds: Set<string>): CandidateCluster[]` et helper statique `collectKnownTxIds(loans: Loan[], subscriptions: Subscription[]): Set<string>` (union des `transactionId` des `occurrencesDetected` des deux entités).

Règles de clustering (spec §1) :
- Candidats : `amount < 0`, `transactionId` non présent dans `excludedTxIds`.
- Normalisation : lowercase ; retrait des préfixes génériques en tête (`achat cb`, `prélèvement`, `prelevement`, `paiement`, `virement`) ; puis extraction creditor/merchant : si la description contient `*` → partie gauche = creditor, droite = merchant (chacune nettoyée des chiffres/mots de mois/ponctuation) ; sinon creditor = 1er token restant, merchant = 2e token s'il existe sinon null. Clé = `creditor|merchant` (merchant vide → `creditor|`).
- Cluster retenu si ≥ 2 occurrences. Occurrences triées par date.

- [ ] **Step 1: Écrire les tests failing**

```ts
// backend/src/modules/credit-detection/candidate-clustering.service.spec.ts
import { CandidateClusteringService } from './candidate-clustering.service';
import { MonthlyStatement } from '../../models/monthly-statement.model';

const tx = (id: string, date: string, description: string, amount: number) => ({
  id, date, description, normalizedDescription: description.toLowerCase(),
  amount, currency: 'EUR', category: 'shopping', subcategory: '', isRecurring: false, confidence: 1,
});
const stmt = (id: string, month: number, txs: ReturnType<typeof tx>[]): MonthlyStatement => ({
  id, month, year: 2026, uploadedAt: '', bankName: 'X', accountHolder: 'Demo', currency: 'EUR',
  openingBalance: 0, closingBalance: 0, totalCredits: 0, totalDebits: 0, transactions: txs,
  healthScore: { total: 50, breakdown: { savingsRate: 50, expenseControl: 50, debtBurden: 50, cashFlowBalance: 50, irregularSpending: 50 }, trend: 'insufficient_data', claudeComment: '' },
  recurringCredits: [], analysisNarrative: '', externalAccountBalances: [],
});

describe('CandidateClusteringService', () => {
  const svc = new CandidateClusteringService();

  it('groupe une série N× par creditor|merchant, extrait le split sur *', () => {
    const clusters = svc.buildClusters([stmt('2026-01', 1, [
      tx('a', '2026-01-10', 'Achat CB Klarni*Zoland 4X', -44.98),
      tx('b', '2026-02-10', 'Klarni*Zoland', -44.98),
      tx('c', '2026-01-15', 'COURSES SUPERETTE', -60),
    ])], new Set());
    expect(clusters).toHaveLength(1);
    expect(clusters[0].creditor).toBe('klarni');
    expect(clusters[0].merchant).toBe('zoland');
    expect(clusters[0].occurrences.map((o) => o.transactionId)).toEqual(['a', 'b']);
  });

  it('exclut les crédits (amount > 0) et les tx déjà connues (excludedTxIds)', () => {
    const clusters = svc.buildClusters([stmt('2026-01', 1, [
      tx('a', '2026-01-10', 'PayFriend *Paieme', -48.18),
      tx('b', '2026-02-10', 'PayFriend *Paieme', -48.18),
      tx('in', '2026-01-12', 'PayFriend *Paieme', 48.18),
    ])], new Set(['b']));
    expect(clusters).toHaveLength(0); // il ne reste qu'une occurrence → < 2
  });

  it('un débit isolé ne forme pas de cluster', () => {
    const clusters = svc.buildClusters([stmt('2026-01', 1, [
      tx('a', '2026-01-10', 'Achat CB Almi', -91),
    ])], new Set());
    expect(clusters).toHaveLength(0);
  });

  it('sans étoile : creditor = 1er token utile après retrait des préfixes génériques', () => {
    const clusters = svc.buildClusters([stmt('2026-01', 1, [
      tx('a', '2026-01-10', 'Prélèvement Almi 3 fois', -91),
      tx('b', '2026-02-12', 'Achat CB Almi', -91.5),
    ])], new Set());
    expect(clusters).toHaveLength(1);
    expect(clusters[0].creditor).toBe('almi');
    expect(clusters[0].occurrences).toHaveLength(2);
  });
});
```

- [ ] **Step 2: FAIL vérifié** (`npx jest src/modules/credit-detection`)
- [ ] **Step 3: Implémentation** — service sans dépendance injectée (méthodes pures) :

```ts
// backend/src/modules/credit-detection/candidate-clustering.service.ts
import { Injectable } from '@nestjs/common';
import { MonthlyStatement } from '../../models/monthly-statement.model';
import { Loan } from '../../models/loan.model';
import { Subscription } from '../../models/subscription.model';
import { CandidateCluster, ClusterOccurrence } from '../../models/credit-detection.model';

const GENERIC_PREFIXES = ['achat cb', 'prélèvement', 'prelevement', 'paiement', 'virement'];
const MONTH_WORDS = /\b(janvier|fevrier|février|mars|avril|mai|juin|juillet|aout|août|septembre|octobre|novembre|decembre|décembre)\b/g;
const MIN_OCCURRENCES = 2;

@Injectable()
export class CandidateClusteringService {
  static collectKnownTxIds(loans: Loan[], subscriptions: Subscription[]): Set<string> {
    const ids = new Set<string>();
    for (const l of loans) for (const o of l.occurrencesDetected) if (o.transactionId) ids.add(o.transactionId);
    for (const s of subscriptions) for (const o of s.occurrencesDetected) if (o.transactionId) ids.add(o.transactionId);
    return ids;
  }

  buildClusters(statements: MonthlyStatement[], excludedTxIds: Set<string>): CandidateCluster[] {
    const byKey = new Map<string, { creditor: string; merchant: string | null; occ: ClusterOccurrence[] }>();
    for (const st of statements) {
      for (const t of st.transactions) {
        if (t.amount >= 0 || excludedTxIds.has(t.id)) continue;
        const parsed = this.parseCounterpart(t.description);
        if (!parsed) continue;
        const key = `${parsed.creditor}|${parsed.merchant ?? ''}`;
        const entry = byKey.get(key) ?? { creditor: parsed.creditor, merchant: parsed.merchant, occ: [] };
        entry.occ.push({ date: t.date, amount: t.amount, description: t.description, transactionId: t.id, statementId: st.id });
        byKey.set(key, entry);
      }
    }
    return [...byKey.entries()]
      .filter(([, v]) => v.occ.length >= MIN_OCCURRENCES)
      .map(([key, v]) => ({ key, creditor: v.creditor, merchant: v.merchant, occurrences: v.occ.sort((a, b) => a.date.localeCompare(b.date)) }));
  }

  private clean(part: string): string {
    return part.toLowerCase().replace(MONTH_WORDS, ' ').replace(/\d+/g, ' ')
      .replace(/[^a-zà-ÿ\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private parseCounterpart(description: string): { creditor: string; merchant: string | null } | null {
    let d = description.toLowerCase().trim();
    for (const p of GENERIC_PREFIXES) if (d.startsWith(p)) d = d.slice(p.length).trim();
    if (d.includes('*')) {
      const [left, right] = d.split('*', 2);
      const creditor = this.clean(left).split(' ')[0] ?? '';
      const merchant = this.clean(right).split(' ')[0] || null;
      return creditor ? { creditor, merchant } : null;
    }
    const tokens = this.clean(d).split(' ').filter(Boolean);
    if (tokens.length === 0) return null;
    return { creditor: tokens[0], merchant: tokens[1] ?? null };
  }
}
```

Le module squelette :

```ts
// backend/src/modules/credit-detection/credit-detection.module.ts
import { Module } from '@nestjs/common';
import { CandidateClusteringService } from './candidate-clustering.service';

@Module({
  providers: [CandidateClusteringService],
  exports: [CandidateClusteringService],
})
export class CreditDetectionModule {}
```

Ajouter `CreditDetectionModule` aux imports d'`app.module.ts` (à côté de `HealthCheckModule`).

- [ ] **Step 4: Tests verts + suite complète verte**
- [ ] **Step 5: Commit** — `feat(detection): clustering déterministe des candidats crédits/N×`

---

### Task 2: CreditClassifierService (LLM local)

**Files:**
- Create: `backend/src/modules/credit-detection/credit-classifier.service.ts`
- Modify: `backend/src/config/configuration.ts` (ajouter `ollamaDetectionModel: process.env.OLLAMA_DETECTION_MODEL ?? 'qwen3:32b'`)
- Modify: `backend/src/modules/credit-detection/credit-detection.module.ts` (provider + `ConfigModule`)
- Test: `backend/src/modules/credit-detection/credit-classifier.service.spec.ts`

**Interfaces:**
- Consumes: `CandidateCluster`, `ClusterClassification` (Task 1), `ConfigService` (`ollamaAdviceBaseUrl` existant + `ollamaDetectionModel`).
- Produces: `CreditClassifierService.classify(cluster: CandidateCluster): Promise<ClusterClassification>` — throw en cas d'erreur HTTP/JSON/validation (l'appelant Task 5 catch par cluster).

Comportement :
- En-tête de fichier : commentaire bloc expliquant l'exception privacy (libellés envoyés au LLM local uniquement — jamais un endpoint distant).
- Appel `POST ${ollamaAdviceBaseUrl}/api/generate` `{ model: ollamaDetectionModel, stream: false, format: 'json', prompt }`, `AbortSignal.timeout(60_000)` (pattern exact de `health-advice.service.ts:requestOllamaAdvice` — le relire avant d'écrire).
- Prompt système français : « Tu es un analyste de relevés bancaires français. On te donne une série de débits regroupés par contrepartie (libellés, montants, dates). Classe la série : `installment` = paiement en plusieurs fois (série courte de montants quasi identiques, ~mensuels, créancier BNPL type Klarna/Alma/PayPal/Oney/Floa) ; `revolving` = mensualité d'une réserve renouvelable ; `classic` = mensualité fixe d'un crédit amortissable ; `subscription` = abonnement récurrent long à montant fixe ; `not_credit` = achats ponctuels sans lien de crédit. N'invente aucun chiffre. Réponds UNIQUEMENT en JSON : {"classification":"...","creditor":"...","merchant":"...ou null","installmentCount":N ou null,"confidence":0.0-1.0,"rationale":"..."} » + le cluster sérialisé (libellés + montants + dates).
- Validation stricte de la réponse : `classification` dans l'enum, `creditor` string non vide, `confidence` number 0-1, `installmentCount` null ou entier 2-24 → sinon `throw new Error('Réponse Ollama invalide: …')`.

- [ ] **Step 1: Tests failing** — mock `global.fetch` (jest.spyOn, pattern de `health-advice.service.spec.ts`) : (a) réponse valide → objet retourné + prompt capturé contient les libellés du cluster et le mot 'installment' ; (b) HTTP 500 → throw ; (c) JSON invalide dans `response` → throw « invalide » ; (d) classification hors enum (`'loan'`) → throw ; (e) confidence 1.4 → throw ; (f) fetch reject → throw. Écrire les 6 `it` complets (cluster fixture : 3 occurrences 'Klarni*Zoland' −44.98/−41.99/−51.97).
- [ ] **Step 2: FAIL vérifié**
- [ ] **Step 3: Implémentation** (copier la mécanique fetch/parse de `health-advice.service.ts`, adapter prompt + validation)
- [ ] **Step 4: Tests verts + suite complète**
- [ ] **Step 5: Commit** — `feat(detection): classification des clusters par LLM local (fail-loud)`

---

### Task 3: DetectionValidatorService + suggestions installment (modèle)

**Files:**
- Modify: `backend/src/models/loan-suggestion.model.ts` (champ optionnel installment)
- Create: `backend/src/modules/credit-detection/detection-validator.service.ts`
- Modify: `backend/src/modules/credit-detection/credit-detection.module.ts` (provider + imports `LoansModule`, `LoanSuggestionsModule`)
- Test: `backend/src/modules/credit-detection/detection-validator.service.spec.ts`

**Interfaces:**
- Consumes: `CandidateCluster`, `ClusterClassification` (Task 1) ; `LoansService.findExistingLoan(signals)` (existant — lire sa signature exacte dans `loans.service.ts` avant d'écrire : elle prend des signaux creditor/monthlyAmount/description et retourne `{ loan, confidence } | null`) ; `LoanSuggestionsService.upsertMany(statementId, incoming: IncomingSuggestion[])` (existant, dédup incluse).
- Produces: `DetectionValidatorService.validate(cluster, classification): Promise<{ created: boolean; reason?: string }>` — crée la suggestion appropriée si tout passe. Extension modèle consommée par Tasks 4-6 :

```ts
// ajout dans loan-suggestion.model.ts
export interface InstallmentSuggestionInfo {
  count: number | null;        // nb d'échéances estimé par le LLM (null = inconnu)
  merchant: string | null;
  occurrenceTxIds: string[];   // transactions observées de la série
  amounts: number[];           // montants observés (positifs)
  dates: string[];             // dates observées YYYY-MM-DD
}
// LoanSuggestion et IncomingSuggestion gagnent : installment?: InstallmentSuggestionInfo;
// LoanSuggestion gagne aussi : source?: 'claude_import' | 'llm_detection'; (défaut absent = claude_import)
```

Règles de validation (spec §3) :
- `confidence < 0.6` → `{ created: false, reason: 'low_confidence' }`.
- **installment** : tous les montants (abs) dans ±5 % de la médiane ; écart médian entre occurrences consécutives entre 25 et 35 jours (si ≥ 2 intervalles ; 1 seul intervalle → accepté s'il est entre 20 et 40 j) ; ≤ 1 occurrence par mois calendaire ; `occurrences.length ≤ installmentCount` si non-null ; `findExistingLoan` sans match high/medium. Tout OK → `upsertMany` avec `IncomingSuggestion` : `label` = `«N× {creditor} · {merchant}»` (ou sans merchant), `monthlyAmount` = médiane abs, `suggestedType: 'loan'`, `matchPattern` = creditor échappé regex, `creditor`, `installment: {...}`, `source: 'llm_detection'`.
- **revolving / classic** : `findExistingLoan` sans match → `upsertMany` suggestion loan standard (`suggestedType: 'loan'`, sans `installment`).
- **subscription** : `upsertMany` avec `suggestedType: 'subscription'`.
- **not_credit** → `{ created: false, reason: 'not_credit' }`.
- `upsertMany` déduplique déjà par pattern — s'appuyer dessus (vérifier son comportement dans `loan-suggestions.service.ts:36` et adapter l'appel si la dédup exige un format précis de `matchPattern`).

- [ ] **Step 1: Tests failing** — mocks jest pour LoansService/LoanSuggestionsService : (a) installment valide (3 occ −44.98/−41.99/−51.97 ±5 % ? NON — prendre 3 occ −44.98/−44.50/−45.10 pour rester dans ±5 %) → upsertMany appelé avec label `4× klarni · zoland`-style, installment.occurrenceTxIds remplis ; (b) montants hors ±5 % (−44.98/−90) → pas d'appel, reason ; (c) 2 occurrences dans le même mois → rejeté ; (d) confidence 0.5 → low_confidence ; (e) findExistingLoan match medium → rejeté ; (f) subscription → upsertMany suggestedType subscription ; (g) not_credit → rien. 7 tests complets.
- [ ] **Step 2: FAIL vérifié**
- [ ] **Step 3: Implémentation**
- [ ] **Step 4: Tests verts + suite complète (le champ optionnel ne casse aucun test suggestions existant)**
- [ ] **Step 5: Commit** — `feat(detection): validateur déterministe + suggestions installment`

---

### Task 4: Accept d'une suggestion installment → loan kind='installment'

**Files:**
- Modify: `backend/src/modules/loans/loans.service.ts` (factoriser la construction de schedule)
- Modify: `backend/src/modules/loan-suggestions/loan-suggestions.controller.ts` + `.service.ts` (endpoint accept-installment)
- Test: `backend/src/modules/loan-suggestions/loan-suggestions.service.spec.ts` (étendre) ou spec dédié si absent — vérifier l'existant

**Interfaces:**
- Consumes: `LoanSuggestion.installment` (Task 3), `LoansService.convertToInstallment(loanId)` (existant, `loans.service.ts:953` — LIRE sa logique de reconstruction de schedule et la factoriser en helper réutilisable `buildInstallmentSchedule(occurrences: {date, amount}[], totalCount: number | null): InstallmentLine[]` : occurrences observées → lignes paid=true ; si totalCount > observées → lignes futures projetées au même pas médian et montant médian, paid=false).
- Produces: `POST /api/loan-suggestions/:id/accept-installment` → crée le loan `kind: 'installment'` (type 'classic', category 'consumer', creditor, `installmentMerchant`, `installmentSchedule` construit, matchPattern = creditor, occurrences seedées depuis `occurrenceTxIds` — vérifier la forme exacte attendue par `markInstallmentPaid`/`addOccurrence` dans le code existant), marque la suggestion `accepted` avec `acceptedAsLoanId`. 404 si la suggestion n'a pas de champ `installment`.

- [ ] **Step 1: Tests failing** — (a) accept-installment d'une suggestion avec installment {count 4, 3 occ observées} → loan créé kind installment, schedule 4 lignes dont 3 paid, 4e projetée ~1 mois après la dernière au montant médian ; (b) suggestion sans installment → BadRequest ; (c) suggestion déjà accepted → conflit/BadRequest (suivre le comportement des transitions existantes).
- [ ] **Step 2: FAIL vérifié**
- [ ] **Step 3: Implémentation** (factorisation `buildInstallmentSchedule` SANS changer le comportement de `convertToInstallment` — ses tests existants restent verts)
- [ ] **Step 4: Tests verts + suite complète**
- [ ] **Step 5: Commit** — `feat(detection): accept d'une suggestion N× → loan installment avec échéancier`

---

### Task 5: Orchestrateur + endpoints + hook post-import

**Files:**
- Create: `backend/src/modules/credit-detection/credit-detection.service.ts`
- Create: `backend/src/modules/credit-detection/credit-detection.controller.ts`
- Modify: `backend/src/modules/credit-detection/credit-detection.module.ts` (controller + providers + imports `StorageModule`, `SubscriptionsModule`, `ImportLogsModule` — vérifier le nom exact du module import-logs)
- Modify: `backend/src/modules/statements/statements.controller.ts` et `backend/src/modules/analysis/analysis.controller.ts` (hook fire-and-forget post-sync)
- Test: `backend/src/modules/credit-detection/credit-detection.service.spec.ts`

**Interfaces:**
- Consumes: les 3 services des Tasks 1-3, `StorageService.getAllStatements()`, `LoansService.getAll()`, `SubscriptionsService.getAll()`, `ImportLogsService` (lire sa signature `log()`/`update()` dans le module import-logs).
- Produces:
  - `CreditDetectionService.scanAll(): Promise<DetectionScanResult>` — clusters sur tous les relevés, boucle séquentielle : `classify` en try/catch par cluster (erreur → push dans `errors`, continue), `validate` si classifié. Si TOUS les appels classify échouent avec des erreurs réseau (fetch reject) → throw `BadGatewayException('Ollama indisponible : …')` (le bouton doit voir un 502, pas un résultat vide).
  - `CreditDetectionService.scanStatement(statement: MonthlyStatement): Promise<DetectionScanResult>` — mêmes étapes sur les seules transactions de ce relevé (clusters construits sur CE statement ; les tx déjà couvertes par loans/subs restent exclues).
  - `POST /api/credit-detection/scan` → `scanAll()` (synchrone, PinGuard implicite).
  - Hook post-import dans les DEUX controllers d'import, immédiatement après le succès du sync : `void this.creditDetection.scanStatement(saved).then((r) => this.importLogs.log({ … 'détection IA : X suggestions, Y erreurs' … })).catch((e) => this.importLogs.log({ … 'détection IA échouée: ' + e.message … }))` — adapter à l'API réelle d'ImportLogsService (regarder comment les logs existants sont écrits lignes 185-205 de statements.controller.ts) ; l'import lui-même ne doit JAMAIS échouer ou ralentir à cause de la détection.

- [ ] **Step 1: Tests failing** — mocks des 3 services + storage : (a) scanAll 2 clusters → classify appelé 2×, validate 2×, résultat {2, N, []} ; (b) 1 cluster en erreur JSON → errors[1], l'autre traité ; (c) tous en fetch-reject → throw BadGateway ; (d) scanStatement ne cluster que le statement passé ; (e) confidence basse → suggestionsCreated 0 sans erreur.
- [ ] **Step 2: FAIL vérifié**
- [ ] **Step 3: Implémentation + hooks controllers**
- [ ] **Step 4: Tests verts + suite complète**
- [ ] **Step 5: Commit** — `feat(detection): orchestrateur scan + endpoint + hook post-import`

---

### Task 6: Frontend — bouton scan + suggestions installment

**Files:**
- Modify: `frontend/src/types/api.ts` (DetectionScanResult, InstallmentSuggestionInfo, champ installment/source sur LoanSuggestion)
- Modify: `frontend/src/lib/queries.ts` (`useDetectionScan` mutation POST `/credit-detection/scan` ; `useAcceptInstallmentSuggestion` mutation POST `/loan-suggestions/:id/accept-installment` — invalider les queries loans + suggestions)
- Modify: `frontend/src/routes/loans.tsx` (bouton « Détecter les crédits (IA locale) » + résumé/erreurs du scan ; dans le bandeau suggestions existant : variante d'affichage installment « N× chez {merchant} » + bouton « C'est un paiement en N fois » → accept-installment)
- Test: `cd frontend && npx tsc --noEmit && npm run test`

**Interfaces:**
- Consumes: endpoints Tasks 4-5 ; patterns existants du bandeau suggestions dans `loans.tsx` (le lire pour suivre sa structure exacte).
- Produces: UI complète du flux détection.

- [ ] **Step 1: Types + hooks** (suivre le style de `queries.ts`)
- [ ] **Step 2: UI loans.tsx** — bouton avec spinner long (texte « analyse en cours sur la 5090… », le scan peut durer 1-3 min), à la fin : toast/encart « X clusters analysés, Y suggestions créées, Z erreurs » (erreurs listées dépliables) ; 502 → encart negative « Ollama éteint ? » + message. Suggestions installment reconnaissables (badge « N× »).
- [ ] **Step 3: `npx tsc --noEmit` + `npm run test` verts**
- [ ] **Step 4: Commit** — `feat(detection): UI scan IA locale + accept des suggestions N×`

---

### Task 7: Opérations neutres (diagnostic santé)

**Files:**
- Modify: `backend/src/modules/health/health.service.ts` (`computeResteAVivre` + helper `findNeutralPairs`)
- Modify: `frontend/src/routes/health.tsx` (`DETAIL_LABELS` : `operationsNeutres: 'Opérations neutres (exclues)'`)
- Test: `backend/src/modules/health/health.service.spec.ts` (étendre)

**Interfaces:**
- Consumes: `HealthContext` existant (statements, loans), tx exclues existantes (occurrences loans/subs, mouvements épargne — réutiliser les Sets déjà construits dans `computeResteAVivre`).
- Produces: `details.operationsNeutres: number` (total absolu exclu) dans le bloc resteAVivre.

Règle (spec) : sur la fenêtre des 3 derniers relevés, apparier `(crédit entrant, débit sortant)` avec `|montants|` égaux à ±0.01 € et écart ≤ 7 jours ; exclusions : tx déjà exclues (loans/subs/épargne) et tx dont la description matche le `matchPattern` d'un loan actif ; appariement glouton par proximité de date, chaque tx dans au plus une paire ; les DEUX jambes sortent des dépenses courantes (la jambe entrante n'était de toute façon pas comptée dans les dépenses — l'effet net est le retrait de la jambe sortante — mais l'appariement exige la présence de l'entrée).

- [ ] **Step 1: Tests failing** — (a) paire +1980.55/−1980.55 à 1 jour → dépenses courantes sans la jambe sortante, `details.operationsNeutres = 1980.55` ; (b) 2 débits identiques sans entrée → comptés normalement, operationsNeutres 0 ; (c) paire à 8 jours d'écart → non appariée ; (d) entrée seule → dépenses inchangées ; (e) 2 sorties pour 1 entrée de même montant → une seule appariée (la plus proche en date).
- [ ] **Step 2: FAIL vérifié**
- [ ] **Step 3: Implémentation + label frontend**
- [ ] **Step 4: Tests verts (backend complet + tsc/vitest frontend)**
- [ ] **Step 5: Commit** — `feat(health): opérations neutres exclues des dépenses courantes`

---

### Task 8: Bench prompt réel + doc + wrap-up

**Files:**
- Modify: `CLAUDE.md` (section détection : architecture 3 verrous, exception privacy libellés→LLM local, modèle, seuil confiance)
- Modify: `backend/.env.example` (`OLLAMA_DETECTION_MODEL=qwen3:32b`)
- Sorties bench : `~/projects/developpeur/tmp/detection-bench/`

- [ ] **Step 1: Build + restart app** (`npm run build`, `local/stop.sh`, `local/run.sh`).
- [ ] **Step 2: Bench réel** — `POST /api/credit-detection/scan` sur les vraies données ; sauvegarder le résultat + examiner les suggestions créées (table `loan-suggestions.json`) : les séries PayPal/Klarna/Alma repérées en cadrage doivent ressortir. Si classifications décevantes → itérer le prompt (pattern /tune-llm-prompt-loop), re-scanner (les suggestions sont dédupliquées).
- [ ] **Step 3: Présenter les suggestions à Sylvain** — c'est LUI qui accepte/rejette dans l'UI ; recueillir son verdict sur la qualité.
- [ ] **Step 4: CLAUDE.md + .env.example + commit** — `docs+chore(detection): doc module détection + config`.
- [ ] **Step 5: Wrap-up** — suites complètes vertes, app relancée, mémoire de session.

---

## Self-review (faite à l'écriture)

- Spec coverage : §1 clustering → T1 ; §2 classifier/prompt/fail-loud → T2 ; §3 validateur/suggestions/accept → T3-T4 ; §4 endpoints/hook/UI → T5-T6 ; opérations neutres → T7 ; erreurs → T2 (throw), T5 (agrégation + 502 + import-log) ; tests → chaque task ; bench réel → T8. Hors-scope respecté.
- Placeholders : néant — chaque comportement a son code ou sa règle chiffrée ; les points « lire l'existant avant d'écrire » désignent des fichiers précis avec lignes.
- Types cohérents : `CandidateCluster`/`ClusterClassification`/`DetectionScanResult` définis T1, consommés T2/T3/T5/T6 sous les mêmes noms ; `InstallmentSuggestionInfo` défini T3, consommé T4/T6.
