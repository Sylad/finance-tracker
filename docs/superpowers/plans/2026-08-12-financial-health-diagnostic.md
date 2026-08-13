# Santé financière — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Page `/health` avec verdict rouge/orange/vert explicable (4 blocs d'indicateurs déterministes, seuils configurables) + conseils générés par LLM local (Ollama, RTX 5090).

**Architecture:** Nouveau module NestJS `health/` (pattern identique à `dashboard/`) : moteur déterministe `HealthService`, seuils persistés `HealthThresholdsService`, pont LLM `HealthAdviceService` (fail-loud, agrégats uniquement). Frontend React : page `routes/health.tsx` + tuile dashboard. Spec source : `docs/superpowers/specs/2026-08-12-financial-health-diagnostic-design.md`.

**Tech Stack:** NestJS 11, Jest (backend), React 18 + TanStack Router/Query + shadcn + Recharts, vitest (frontend), Ollama API (`/api/generate`, `format: json`).

## Global Constraints

- JAMAIS de vraies données de Sylvain dans les tests/fixtures (règle projet CLAUDE.md) — montants et créanciers synthétiques uniquement.
- Préfixe API : `/api/health-check/*` (PAS `/api/health` — collision avec le healthcheck technique). PinGuard global s'applique automatiquement (pas dans la whitelist).
- Les revenus excluent TOUJOURS les transactions marquées `draw` (occurrences des loans). Aucun nom d'employeur en dur.
- Fail-loud LLM : Ollama down/JSON invalide/timeout → erreur explicite, JAMAIS de fallback silencieux ni d'appel API Claude cloud.
- Verdict global = pire statut des 4 blocs. Pas de score agrégé.
- Persistance : `atomicWriteJson` + `RequestDataDirService.getDataDir()` (compat mode démo), comme `budget.service.ts`.
- Tests backend : `cd backend && npx jest src/modules/health` ; suite complète `npx jest` doit rester verte (219 tests avant ce chantier).
- Commits : messages `feat(health): …`, footer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Types partagés + HealthThresholdsService + module scaffold

**Files:**
- Create: `backend/src/models/health.model.ts`
- Create: `backend/src/modules/health/health-thresholds.service.ts`
- Create: `backend/src/modules/health/health.controller.ts`
- Create: `backend/src/modules/health/health.module.ts`
- Modify: `backend/src/app.module.ts` (ajouter `HealthCheckModule` aux imports — nom choisi pour éviter la collision avec un éventuel HealthModule technique)
- Test: `backend/src/modules/health/health-thresholds.service.spec.ts`

**Interfaces:**
- Produces: types `HealthStatus`, `HealthThresholds`, `DEFAULT_THRESHOLDS` ; `HealthThresholdsService.get(): Promise<HealthThresholds>`, `.update(patch: Partial<HealthThresholds>): Promise<HealthThresholds>`, `.reset(): Promise<HealthThresholds>` ; routes `GET/PUT /api/health-check/thresholds`, `POST /api/health-check/thresholds/reset`.

- [ ] **Step 1: Écrire le modèle**

```ts
// backend/src/models/health.model.ts
export type HealthStatus = 'green' | 'orange' | 'red';

export interface HealthThresholds {
  // Reste à vivre : rouge si < 0 (fixe), orange si < orangeBelowPctIncome % des revenus
  resteAVivre: { orangeBelowPctIncome: number };
  // Taux d'effort (mensualités / revenus)
  tauxEffort: { orangeAbovePct: number; redAbovePct: number };
  // Utilisation des plafonds revolving
  plafonds: { greenBelowPct: number; orangeAbovePct: number; redAbovePct: number };
  // Flux tirages : orange si > 0 (fixe), rouge si > redAbovePctIncome % des revenus
  tirages: { redAbovePctIncome: number };
  // Trajectoire
  trajectoire: { horizonMonths: number; stableBandPct: number };
  // Override manuel du revenu mensuel (prime toujours sur la détection). null = auto.
  manualMonthlyIncome: number | null;
}

export const DEFAULT_THRESHOLDS: HealthThresholds = {
  resteAVivre: { orangeBelowPctIncome: 10 },
  tauxEffort: { orangeAbovePct: 33, redAbovePct: 50 },
  plafonds: { greenBelowPct: 60, orangeAbovePct: 80, redAbovePct: 95 },
  tirages: { redAbovePctIncome: 15 },
  trajectoire: { horizonMonths: 6, stableBandPct: 5 },
  manualMonthlyIncome: null,
};

export interface HealthBlockResult {
  status: HealthStatus;
  // Phrase du seuil déclencheur, ex "rouge car reste à vivre < 0 €" — null si vert
  thresholdHit: string | null;
  // Valeurs chiffrées propres au bloc, pour l'UI (détail dépliable)
  details: Record<string, number | string | null>;
}

export interface HealthDiagnostic {
  verdict: HealthStatus;
  causes: string[]; // phrases, une par bloc non-vert
  blocks: {
    resteAVivre: HealthBlockResult;
    chargeDette: HealthBlockResult;
    fluxTirages: HealthBlockResult;
    trajectoire: HealthBlockResult;
  };
  income: {
    monthly: number | null;
    source: 'detected' | 'manual' | 'transition' | 'unavailable';
    label: string | null; // contrepartie détectée (affichage), jamais utilisée en logique
  };
  reliability: 'ok' | 'reduced' | 'unavailable'; // reduced si < 3 relevés
  computedAt: string;
}
```

- [ ] **Step 2: Écrire le test failing du service seuils**

```ts
// backend/src/modules/health/health-thresholds.service.spec.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HealthThresholdsService } from './health-thresholds.service';
import { RequestDataDirService } from '../demo/request-data-dir.service';
import { DEFAULT_THRESHOLDS } from '../../models/health.model';

describe('HealthThresholdsService', () => {
  let svc: HealthThresholdsService;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-health-'));
    const dataDir = { getDataDir: () => tmpDir } as unknown as RequestDataDirService;
    svc = new HealthThresholdsService(dataDir);
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('retourne les défauts quand le fichier est absent', async () => {
    expect(await svc.get()).toEqual(DEFAULT_THRESHOLDS);
  });

  it('update partiel : merge sur les défauts et persiste', async () => {
    const out = await svc.update({ tauxEffort: { orangeAbovePct: 30, redAbovePct: 45 } });
    expect(out.tauxEffort.redAbovePct).toBe(45);
    expect(out.plafonds).toEqual(DEFAULT_THRESHOLDS.plafonds); // non touché
    expect((await svc.get()).tauxEffort.orangeAbovePct).toBe(30); // relu depuis disque
  });

  it('fichier partiel sur disque : les clés manquantes reprennent les défauts', async () => {
    fs.writeFileSync(path.join(tmpDir, 'health-thresholds.json'),
      JSON.stringify({ manualMonthlyIncome: 2500 }));
    const out = await svc.get();
    expect(out.manualMonthlyIncome).toBe(2500);
    expect(out.tauxEffort).toEqual(DEFAULT_THRESHOLDS.tauxEffort);
  });

  it('reset restaure les défauts', async () => {
    await svc.update({ manualMonthlyIncome: 9999 });
    expect(await svc.reset()).toEqual(DEFAULT_THRESHOLDS);
    expect(await svc.get()).toEqual(DEFAULT_THRESHOLDS);
  });
});
```

- [ ] **Step 3: Lancer le test — il doit FAIL** (`npx jest src/modules/health -t Thresholds` → module inexistant)

- [ ] **Step 4: Implémenter le service**

```ts
// backend/src/modules/health/health-thresholds.service.ts
import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteJson } from '../../common/atomic-write';
import { RequestDataDirService } from '../demo/request-data-dir.service';
import { DEFAULT_THRESHOLDS, HealthThresholds } from '../../models/health.model';

const FILE = 'health-thresholds.json';

@Injectable()
export class HealthThresholdsService {
  constructor(private readonly dataDir: RequestDataDirService) {}

  private get filepath(): string {
    return path.resolve(this.dataDir.getDataDir(), FILE);
  }

  async get(): Promise<HealthThresholds> {
    try {
      const raw = JSON.parse(await fs.promises.readFile(this.filepath, 'utf8')) as Partial<HealthThresholds>;
      return this.mergeDefaults(raw);
    } catch {
      return structuredClone(DEFAULT_THRESHOLDS);
    }
  }

  async update(patch: Partial<HealthThresholds>): Promise<HealthThresholds> {
    const merged = this.mergeDefaults({ ...(await this.get()), ...patch });
    await atomicWriteJson(this.filepath, merged);
    return merged;
  }

  async reset(): Promise<HealthThresholds> {
    const defaults = structuredClone(DEFAULT_THRESHOLDS);
    await atomicWriteJson(this.filepath, defaults);
    return defaults;
  }

  private mergeDefaults(raw: Partial<HealthThresholds>): HealthThresholds {
    return {
      resteAVivre: { ...DEFAULT_THRESHOLDS.resteAVivre, ...raw.resteAVivre },
      tauxEffort: { ...DEFAULT_THRESHOLDS.tauxEffort, ...raw.tauxEffort },
      plafonds: { ...DEFAULT_THRESHOLDS.plafonds, ...raw.plafonds },
      tirages: { ...DEFAULT_THRESHOLDS.tirages, ...raw.tirages },
      trajectoire: { ...DEFAULT_THRESHOLDS.trajectoire, ...raw.trajectoire },
      manualMonthlyIncome: raw.manualMonthlyIncome ?? null,
    };
  }
}
```

- [ ] **Step 5: Contrôleur + module + wiring**

```ts
// backend/src/modules/health/health.controller.ts
import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { HealthThresholdsService } from './health-thresholds.service';
import { HealthThresholds } from '../../models/health.model';

@Controller('health-check')
export class HealthCheckController {
  constructor(private readonly thresholds: HealthThresholdsService) {}

  @Get('thresholds')
  getThresholds() { return this.thresholds.get(); }

  @Put('thresholds')
  putThresholds(@Body() body: Partial<HealthThresholds>) { return this.thresholds.update(body); }

  @Post('thresholds/reset')
  resetThresholds() { return this.thresholds.reset(); }
}
```

```ts
// backend/src/modules/health/health.module.ts
import { Module } from '@nestjs/common';
import { HealthCheckController } from './health.controller';
import { HealthThresholdsService } from './health-thresholds.service';
import { DemoCoreModule } from '../demo/demo-core.module';

@Module({
  imports: [DemoCoreModule],
  controllers: [HealthCheckController],
  providers: [HealthThresholdsService],
  exports: [HealthThresholdsService],
})
export class HealthCheckModule {}
```

Note : vérifier le nom réel du module qui exporte `RequestDataDirService` (`grep -rn "RequestDataDirService" backend/src/modules/demo/*.module.ts`) et importer celui-là. Dans `app.module.ts`, ajouter `HealthCheckModule` à la liste `imports` (même endroit que `DashboardModule`).

- [ ] **Step 6: Tests verts** (`npx jest src/modules/health`) puis suite complète (`npx jest`) verte.

- [ ] **Step 7: Commit** — `feat(health): module santé + seuils configurables persistés`

---

### Task 2: Détection du revenu stable (helper pur)

**Files:**
- Create: `backend/src/modules/health/income-detection.helper.ts`
- Test: `backend/src/modules/health/income-detection.helper.spec.ts`

**Interfaces:**
- Consumes: `MonthlyStatement` (existant, `../../models/monthly-statement.model`), `Loan` (existant).
- Produces: `detectStableIncome(statements: MonthlyStatement[], drawTxIds: Set<string>, manualMonthlyIncome: number | null): IncomeDetection` avec `interface IncomeDetection { monthly: number | null; source: 'detected' | 'manual' | 'transition' | 'unavailable'; label: string | null; }`. `collectDrawTxIds(loans: Loan[]): Set<string>` (ids des transactions marquées `source='draw'`).

Règles (spec §1) : candidats = crédits entrants (`amount > 0`) hors `drawTxIds` et `amount ≥ 200` ; clé de cluster = description lowercased, chiffres et mots de mois retirés (`janvier..décembre`, noms EN aussi), tokens génériques retirés en tête (`virement`, `de`, `sepa`, `sa`, `sas`, `s.a.s.`), 4 premiers tokens joints ; cluster retenu si ≥ 3 mois calendaires distincts ET médiane par mois ≤ 1.5 occurrence ET tous les montants dans ±25 % de la médiane du cluster ; revenu = somme des médianes (3 derniers mois de chaque cluster retenu). Transition : si le cluster retenu le plus gros n'a AUCUNE occurrence dans le mois calendaire le plus récent couvert par les relevés ET qu'un crédit non-tirage ≥ 50 % de sa médiane existe dans ce mois → `source: 'transition'`, `monthly` = médiane historique (l'UI demandera confirmation). `manualMonthlyIncome` non-null → prime sur tout (`source: 'manual'`). Aucun cluster → `{ monthly: null, source: 'unavailable', label: null }`.

- [ ] **Step 1: Tests failing** (fixtures 100 % synthétiques)

```ts
// backend/src/modules/health/income-detection.helper.spec.ts
import { detectStableIncome } from './income-detection.helper';
import { MonthlyStatement } from '../../models/monthly-statement.model';

const tx = (id: string, date: string, description: string, amount: number) => ({
  id, date, description, normalizedDescription: description.toLowerCase(),
  amount, currency: 'EUR', category: 'income', subcategory: '', isRecurring: true, confidence: 1,
});
const stmt = (id: string, month: number, txs: ReturnType<typeof tx>[]): MonthlyStatement => ({
  id, month, year: 2026, uploadedAt: '', bankName: 'X', accountHolder: 'Demo', currency: 'EUR',
  openingBalance: 0, closingBalance: 0, totalCredits: 0, totalDebits: 0, transactions: txs,
  healthScore: { total: 50, breakdown: { savingsRate: 50, expenseControl: 50, debtBurden: 50, cashFlowBalance: 50, irregularSpending: 50 }, trend: 'insufficient_data', claudeComment: '' },
  recurringCredits: [], analysisNarrative: '', externalAccountBalances: [],
});

describe('detectStableIncome', () => {
  const salaryMonths = [
    stmt('2026-01', 1, [tx('s1', '2026-01-28', 'Virement ACME Corp salaire janvier', 2800)]),
    stmt('2026-02', 2, [tx('s2', '2026-02-27', 'Virement ACME CORP Salaire fevrier', 2950)]),
    stmt('2026-03', 3, [tx('s3', '2026-03-29', 'ACME Corp Salary', 2750),
                         tx('d1', '2026-03-10', 'Virement CrediCorp reserve', 900),
                         tx('r1', '2026-03-12', 'Mutuelle SanteX remboursement', 340)]),
  ];

  it('détecte le cluster salaire stable, exclut tirages et remboursement ponctuel', () => {
    const out = detectStableIncome(salaryMonths, new Set(['d1']), null);
    expect(out.source).toBe('detected');
    expect(out.monthly).toBe(2800); // médiane de 2800/2950/2750
    expect(out.label).toContain('acme');
  });

  it('manualMonthlyIncome prime sur la détection', () => {
    const out = detectStableIncome(salaryMonths, new Set(['d1']), 3100);
    expect(out).toEqual({ monthly: 3100, source: 'manual', label: null });
  });

  it('cluster présent < 3 mois → unavailable', () => {
    const out = detectStableIncome(salaryMonths.slice(0, 2), new Set(), null);
    expect(out.source).toBe('unavailable');
    expect(out.monthly).toBeNull();
  });

  it('montants instables (>±25%) → cluster rejeté', () => {
    const wobbly = [
      stmt('2026-01', 1, [tx('a', '2026-01-15', 'FreelanceX paiement', 1000)]),
      stmt('2026-02', 2, [tx('b', '2026-02-15', 'FreelanceX paiement', 2400)]),
      stmt('2026-03', 3, [tx('c', '2026-03-15', 'FreelanceX paiement', 600)]),
    ];
    expect(detectStableIncome(wobbly, new Set(), null).source).toBe('unavailable');
  });

  it('changement d\'employeur : ancien cluster absent du dernier mois + nouveau gros crédit → transition', () => {
    const months = [
      ...salaryMonths,
      stmt('2026-04', 4, [tx('n1', '2026-04-28', 'Virement NewJob SAS salaire', 3200)]),
    ];
    const out = detectStableIncome(months, new Set(), null);
    expect(out.source).toBe('transition');
    expect(out.monthly).toBe(2800); // médiane historique en attendant confirmation
  });

  it('les tirages ne forment jamais un cluster de revenu', () => {
    const drawsOnly = [
      stmt('2026-01', 1, [tx('d1', '2026-01-10', 'Virement CrediCorp reserve', 650)]),
      stmt('2026-02', 2, [tx('d2', '2026-02-10', 'Virement CrediCorp reserve', 650)]),
      stmt('2026-03', 3, [tx('d3', '2026-03-10', 'Virement CrediCorp reserve', 650)]),
    ];
    const out = detectStableIncome(drawsOnly, new Set(['d1', 'd2', 'd3']), null);
    expect(out.source).toBe('unavailable');
  });
});
```

- [ ] **Step 2: FAIL vérifié** (`npx jest src/modules/health -t detectStableIncome`)

- [ ] **Step 3: Implémentation**

```ts
// backend/src/modules/health/income-detection.helper.ts
import { MonthlyStatement } from '../../models/monthly-statement.model';
import { Loan } from '../../models/loan.model';

export interface IncomeDetection {
  monthly: number | null;
  source: 'detected' | 'manual' | 'transition' | 'unavailable';
  label: string | null;
}

const MONTH_WORDS = /\b(janvier|fevrier|février|mars|avril|mai|juin|juillet|aout|août|septembre|octobre|novembre|decembre|décembre|january|february|march|april|may|june|july|august|september|october|november|december)\b/g;
const GENERIC_PREFIX = new Set(['virement', 'de', 'du', 'sepa', 'vir', 'sa', 'sas', 's.a.s.', 's.a.s']);
const MIN_AMOUNT = 200;
const STABILITY_TOLERANCE = 0.25;
const MIN_DISTINCT_MONTHS = 3;

export function collectDrawTxIds(loans: Loan[]): Set<string> {
  const ids = new Set<string>();
  for (const l of loans) {
    for (const o of l.occurrencesDetected) {
      if (o.source === 'draw' && o.transactionId) ids.add(o.transactionId);
    }
  }
  return ids;
}

function clusterKey(description: string): string {
  const cleaned = description.toLowerCase()
    .replace(MONTH_WORDS, ' ')
    .replace(/\d+/g, ' ')
    .replace(/[^a-zà-ÿ.\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const tokens: string[] = [];
  for (const t of cleaned) {
    if (tokens.length === 0 && GENERIC_PREFIX.has(t)) continue;
    tokens.push(t);
    if (tokens.length === 4) break;
  }
  return tokens.join(' ');
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function detectStableIncome(
  statements: MonthlyStatement[],
  drawTxIds: Set<string>,
  manualMonthlyIncome: number | null,
): IncomeDetection {
  if (manualMonthlyIncome != null) {
    return { monthly: manualMonthlyIncome, source: 'manual', label: null };
  }
  type Candidate = { month: string; amount: number };
  const clusters = new Map<string, Candidate[]>();
  let latestMonth = '';
  for (const st of statements) {
    for (const t of st.transactions) {
      const month = t.date.slice(0, 7);
      if (month > latestMonth) latestMonth = month;
      if (t.amount < MIN_AMOUNT || drawTxIds.has(t.id)) continue;
      const key = clusterKey(t.description);
      if (!key) continue;
      const arr = clusters.get(key);
      if (arr) arr.push({ month, amount: t.amount });
      else clusters.set(key, [{ month, amount: t.amount }]);
    }
  }
  const qualified: { key: string; medianAmount: number; months: Set<string> }[] = [];
  for (const [key, occs] of clusters) {
    const months = new Set(occs.map((o) => o.month));
    if (months.size < MIN_DISTINCT_MONTHS) continue;
    if (occs.length / months.size > 1.5) continue;
    const med = median(occs.map((o) => o.amount));
    if (!occs.every((o) => Math.abs(o.amount - med) <= med * STABILITY_TOLERANCE)) continue;
    const last3 = occs.sort((a, b) => a.month.localeCompare(b.month)).slice(-3);
    qualified.push({ key, medianAmount: median(last3.map((o) => o.amount)), months });
  }
  if (qualified.length === 0) return { monthly: null, source: 'unavailable', label: null };

  qualified.sort((a, b) => b.medianAmount - a.medianAmount);
  const main = qualified[0];
  // Transition emploi : cluster principal absent du dernier mois couvert,
  // mais un crédit non-tirage ≥ 50 % de sa médiane existe dans ce mois.
  if (latestMonth && !main.months.has(latestMonth)) {
    const successor = statements.some((st) => st.transactions.some((t) =>
      t.date.slice(0, 7) === latestMonth && t.amount >= main.medianAmount * 0.5 && !drawTxIds.has(t.id)));
    if (successor) {
      return { monthly: Math.round(main.medianAmount * 100) / 100, source: 'transition', label: main.key };
    }
  }
  const total = qualified.reduce((s, q) => s + q.medianAmount, 0);
  return { monthly: Math.round(total * 100) / 100, source: 'detected', label: main.key };
}
```

- [ ] **Step 4: Tests verts** (ajuster l'implémentation, pas les attentes, si écart)
- [ ] **Step 5: Commit** — `feat(health): détection revenu stable générique (clusters hors tirages)`

---

### Task 3: HealthService — reste à vivre + charge de la dette

**Files:**
- Create: `backend/src/modules/health/health.service.ts`
- Modify: `backend/src/modules/health/health.module.ts` (provider + imports `LoansModule`, `StorageModule`, `SubscriptionsModule`)
- Test: `backend/src/modules/health/health.service.spec.ts`

**Interfaces:**
- Consumes: `LoansService.getAll(): Promise<Loan[]>`, `StorageService.getAllStatements(): Promise<MonthlyStatement[]>`, `SubscriptionsService.getAll()` (champ `monthlyAmount: number`, `isActive: boolean` — vérifier les noms exacts dans `backend/src/models/subscription.model.ts` avant d'écrire), `detectStableIncome`, `collectDrawTxIds`, `HealthThresholdsService.get()`.
- Produces: `HealthService.computeResteAVivre(ctx): HealthBlockResult`, `.computeChargeDette(ctx): HealthBlockResult` où `ctx` est un objet interne `HealthContext { statements, loans, subscriptions, thresholds, income }` construit par une méthode `buildContext()` (une seule lecture des services par diagnostic).

Définitions exactes :
- Mensualités = Σ `monthlyPayment` des loans `isActive`.
- Abonnements = Σ `monthlyAmount` des subscriptions actives.
- Dépenses courantes = moyenne sur les 3 derniers relevés de Σ|débits| EXCLUANT les transactions qui sont des occurrences de loans (par `transactionId`, toutes sources) — approximation assumée : les abonnements restent dans les dépenses courantes, donc ils ne sont PAS soustraits une deuxième fois en tant que ligne séparée (sinon double-compte). La formule est donc : `resteAVivre = income − mensualités − dépensesCourantesHorsCrédits`.
- Taux d'effort = mensualités ÷ income × 100. Plafonds : `usedAmount/maxAmount` par revolving actif + pire cas retenu.
- income null → les deux blocs retournent `status: 'red'`? NON : ils retournent un bloc `details` vide et le diagnostic global (Task 4) court-circuite en `reliability: 'unavailable'`. Pour garder les signatures simples, `computeResteAVivre`/`computeChargeDette` ne sont appelés QUE si `income.monthly != null`.

- [ ] **Step 1: Tests failing** — fixtures synthétiques ; cas : (a) vert (revenu 3000, mensualités 400, dépenses 1500 → RAV 1100 > 10 %), (b) rouge RAV < 0, (c) orange 0-10 %, (d) taux d'effort 40 % → orange, 60 % → rouge, (e) revolving à 96 % du plafond → rouge même avec taux d'effort vert, (f) seuils personnalisés respectés (orangeAbovePct 20 → 25 % devient orange). Mock des services comme dans `auto-sync.service.spec.ts` (jest.Mocked). Écrire les 6 `it(...)` complets sur ce modèle :

```ts
it('reste à vivre négatif → rouge avec thresholdHit explicite', async () => {
  // revenu 2000, mensualités 900, dépenses courantes moyennes 1300 → RAV -200
  // (construire 3 statements avec débits synthétiques + 1 loan actif monthlyPayment 900)
  const block = await svc.computeResteAVivre(ctx);
  expect(block.status).toBe('red');
  expect(block.thresholdHit).toContain('< 0');
  expect(block.details.resteAVivre).toBe(-200);
});
```

- [ ] **Step 2: FAIL vérifié**
- [ ] **Step 3: Implémenter `buildContext()` + les deux méthodes** — statuts calculés par comparaisons pures, chaque `thresholdHit` est une phrase française avec les valeurs (« rouge car taux d'effort 66 % > 50 % »). Arrondir tous les euros à 2 décimales, pourcentages à 1.
- [ ] **Step 4: Tests verts**
- [ ] **Step 5: Commit** — `feat(health): blocs reste à vivre + charge de la dette`

---

### Task 4: HealthService — flux tirages, trajectoire, diagnostic complet + endpoint

**Files:**
- Modify: `backend/src/modules/health/health.service.ts`
- Modify: `backend/src/modules/health/health.controller.ts` (ajout `GET /api/health-check/diagnostic`)
- Test: `backend/src/modules/health/health.service.spec.ts` (étendre)

**Interfaces:**
- Produces: `HealthService.getDiagnostic(): Promise<HealthDiagnostic>` ; route `GET /api/health-check/diagnostic`.

Définitions exactes :
- Flux tirages (3 mois glissants depuis la date du jour) : `tiragesMensuels = Σ occurrences source='draw' / 3` ; `remboursementsMensuels = Σ |occurrences amount<0| des revolvings actifs / 3` ; `flux = tirages − remboursements`. Vert ≤ 0, orange > 0, rouge si `flux > income × redAbovePctIncome/100`.
- Trajectoire : par revolving actif, `trend_i = (tirages_i − remboursements_i) / 3` sur 3 mois ; encours projeté à `horizonMonths` = `usedAmount + horizonMonths × trend_i`. Solde : moyenne des `totalCredits − totalDebits` des 3 derniers relevés, projetée cumulativement. Rouge si un `usedAmount` projeté ≥ `maxAmount` sous l'horizon OU solde moyen mensuel < 0 (structurellement négatif). Vert si Σ encours projetés à 6 mois < Σ encours actuels × (1 − stableBandPct/100). Orange sinon (bande stable ±stableBandPct).
- `getDiagnostic()` : si `income.monthly == null` → `reliability: 'unavailable'`, verdict `orange` avec cause unique « revenus non configurés — diagnostic impossible », blocs remplis de `details` vides. Sinon 4 blocs, verdict = pire, `causes` = `thresholdHit` de chaque bloc non-vert. `reliability: 'reduced'` si < 3 relevés.

- [ ] **Step 1: Tests failing** — cas : (a) tirages > remboursements → orange avec valeurs dans details, (b) flux > 15 % du revenu → rouge, (c) aucune occurrence draw → vert, (d) revolving 5000/6000 avec trend +400/mois → rouge (plafond saturé en 3 mois < horizon 6), (e) verdict global = pire bloc + causes agrégées, (f) income unavailable → reliability 'unavailable' sans exception levée, (g) 2 relevés seulement → reliability 'reduced'.
- [ ] **Step 2: FAIL vérifié**
- [ ] **Step 3: Implémentation + endpoint** (`@Get('diagnostic')` → `this.health.getDiagnostic()`)
- [ ] **Step 4: Tests verts + suite complète verte**
- [ ] **Step 5: Vérification manuelle sur les vraies données** : `bash local/run.sh` puis `curl -s -H "Authorization: Bearer $PIN" localhost:3000/api/health-check/diagnostic | python3 -m json.tool` — vérifier avec Sylvain que le verdict et les causes collent à la réalité (attendu : rouge, taux d'effort ~66 %, Carrefour > 100 %).
- [ ] **Step 6: Commit** — `feat(health): diagnostic complet (tirages, trajectoire, verdict)`

---

### Task 5: HealthAdviceService — conseils LLM local (Ollama)

**Files:**
- Create: `backend/src/modules/health/health-advice.service.ts`
- Modify: `backend/src/modules/health/health.controller.ts` (routes advice)
- Modify: `backend/src/modules/health/health.module.ts` (provider + `ConfigModule`)
- Modify: `backend/src/config/configuration.ts` (ajouter `ollamaAdviceBaseUrl: process.env.OLLAMA_ADVICE_BASE_URL ?? 'http://localhost:11434'` et `ollamaAdviceModel: process.env.OLLAMA_ADVICE_MODEL ?? 'qwen3:32b'`)
- Test: `backend/src/modules/health/health-advice.service.spec.ts`

**Interfaces:**
- Consumes: `HealthService.getDiagnostic()`, `LoansService.getAll()`, `ConfigService`.
- Produces: `HealthAdviceService.generate(): Promise<HealthAdvice>`, `.getCached(): Promise<HealthAdvice | null>` avec `interface HealthAdvice { generatedAt: string; model: string; advices: { priority: number; title: string; explanation: string; estimatedImpact: string }[] }`. Routes `POST /api/health-check/advice` (génère) et `GET /api/health-check/advice` (cache, 204 si vide).

Comportement :
- Contexte prompt = agrégats UNIQUEMENT : le `HealthDiagnostic` sérialisé + par crédit actif `{name, type, usedAmount, maxAmount, taeg, monthlyPayment}` + top 5 catégories de dépenses (réutiliser la logique de `DashboardService.getYearlyOverview` — extraire la boucle catTotals en helper partagé OU recalculer localement sur 3 mois, au choix de l'implémenteur, mais AUCUN libellé de transaction).
- Appel Ollama : POST `${baseUrl}/api/generate`, `{ model, stream: false, format: 'json', prompt }` (pattern exact de `category-rule-suggestions.service.ts:requestOllamaRuleSuggestions`). Prompt système en français : rôle conseiller budgétaire, interdiction d'inventer des chiffres non fournis, priorisation par impact (TAEG les plus chers d'abord), forme JSON exacte `{"advices":[{"priority":1,"title":"...","explanation":"...","estimatedImpact":"..."}]}`.
- Timeout 120 s via `AbortSignal.timeout(120_000)` passé à fetch.
- Validation de la réponse : parse JSON, vérifier `Array.isArray(advices)` et champs requis string/number sur chaque entrée — sinon `throw new Error('Réponse Ollama invalide')`. AUCUN fallback.
- Cache : `atomicWriteJson(dataDir + 'health-advice-cache.json', advice)` après succès ; `getCached()` lit le fichier, null si absent.
- Erreurs remontées par le controller en HTTP 502 avec message explicite (`throw new BadGatewayException('Ollama indisponible : ' + msg)`).

- [ ] **Step 1: Tests failing** — mocker `global.fetch` (jest.spyOn) : (a) réponse valide → advices triés par priority + cache écrit, (b) HTTP 500 → throw « Ollama », (c) JSON invalide dans `response` → throw « invalide », (d) fetch reject (ECONNREFUSED) → throw, (e) `getCached()` sans fichier → null, avec fichier → contenu. Vérifier qu'AUCUN libellé de transaction n'apparaît dans le prompt : test qui construit le contexte avec une transaction au libellé sentinelle `"SENTINELLE-PRIVEE"` et asserte `expect(promptCapturé).not.toContain('SENTINELLE-PRIVEE')`.
- [ ] **Step 2: FAIL vérifié**
- [ ] **Step 3: Implémentation**
- [ ] **Step 4: Tests verts + suite complète**
- [ ] **Step 5: Commit** — `feat(health): conseils LLM local Ollama (fail-loud, agrégats only)`

---

### Task 6: Frontend — page /health (diagnostic)

**Files:**
- Create: `frontend/src/routes/health.tsx`
- Modify: `frontend/src/lib/queries.ts` (hooks `useHealthDiagnostic`, `useHealthThresholds`, `useUpdateThresholds`, `useResetThresholds`, `useHealthAdvice`, `useGenerateAdvice` — suivre le pattern des hooks existants du fichier, `request<T>` de `lib/api.ts`)
- Modify: `frontend/src/router.tsx` (route `/health`, pattern identique à `incomeRoute`)
- Modify: `frontend/src/components/layout/sidebar.tsx:29` (ajouter `{ to: '/health', label: 'Santé', icon: HeartPulse, exact: false }` — icône lucide `HeartPulse`)
- Modify: `frontend/src/components/command-palette.tsx:27` (même entrée)

**Interfaces:**
- Consumes: `GET /api/health-check/diagnostic` → `HealthDiagnostic` (types TS à dupliquer côté `frontend/src/types/` comme le fait l'app pour les autres modèles — vérifier le fichier types existant et suivre son organisation).
- Produces: page `/health` avec bandeau verdict + 4 cartes.

Contenu page (spec §3) :
1. Bandeau verdict : fond `bg-red-600/10 border-red-600` (ou orange/emerald selon statut, tokens Tailwind existants de l'app), phrase de synthèse + `causes` en liste.
2. 4 cartes (grid 2×2 responsive) : titre, chiffre principal (`resteAVivre` €/mois, taux d'effort %, flux €/mois, encours projeté 6 mois), badge statut, `thresholdHit` affiché, `<details>` dépliable avec le contenu de `details` en lignes libellé/valeur. Carte trajectoire : mini `<LineChart>` Recharts (encours actuel → projeté, 2 points par réserve suffisent, pas de sur-ingénierie).
3. États : `reliability === 'unavailable'` → bandeau gris « Diagnostic impossible — configure tes revenus » + `<Link to="/income">` + champ « revenu mensuel manuel » (écrit `manualMonthlyIncome` via `useUpdateThresholds`) ; `reliability === 'reduced'` → badge « fiabilité réduite (moins de 3 relevés) » ; `income.source === 'transition'` → bandeau orange « changement de revenu détecté — confirme le montant » avec le même champ manuel.

- [ ] **Step 1: Écrire les hooks queries + types TS**
- [ ] **Step 2: Écrire la page + route + nav** (suivre la structure JSX d'une page existante simple comme `routes/forecast.tsx`)
- [ ] **Step 3: Vérifier compilation** : `cd frontend && npx tsc --noEmit && npm run test`
- [ ] **Step 4: Validation visuelle Playwright** : `npm run build` racine, relancer `local/run.sh`, screenshot de `http://localhost:3000/health` dans `~/projects/developpeur/tmp/health-page-v1.png`, itérer l'UX avec Sylvain (son pattern : itération par screenshots).
- [ ] **Step 5: Commit** — `feat(health): page /health — verdict + 4 cartes indicateurs`

---

### Task 7: Frontend — conseils, drawer seuils, tuile dashboard

**Files:**
- Modify: `frontend/src/routes/health.tsx` (sections conseils + drawer seuils)
- Modify: `frontend/src/routes/index.tsx` (tuile verdict dashboard)

**Interfaces:**
- Consumes: hooks Task 6 (`useHealthAdvice`, `useGenerateAdvice`, `useHealthThresholds`, `useUpdateThresholds`, `useResetThresholds`, `useHealthDiagnostic`).

Contenu :
- Section conseils : bouton « Générer les conseils (IA locale) » → `useGenerateAdvice` (mutation POST), spinner pendant l'appel (peut durer 30-90 s — texte « génération en cours sur la 5090… »), liste des conseils triés par `priority` (titre en gras, explication, `estimatedImpact` en badge), date `generatedAt` affichée « Générés le … ». Erreur 502 → encart rouge « Conseils indisponibles — Ollama éteint ? » avec le message serveur. Au montage : `useHealthAdvice` (GET cache) pour afficher les derniers conseils sans re-générer.
- Drawer seuils : bouton « Ajuster les seuils » → drawer/sheet shadcn avec un champ numérique par seuil (labels français : « Taux d'effort orange au-dessus de (%) », etc.), bouton « Enregistrer » (`useUpdateThresholds`, invalidation de la query diagnostic) et « Restaurer les défauts » (`useResetThresholds`).
- Tuile dashboard (`routes/index.tsx`) : carte cliquable même gabarit que les tuiles existantes — pastille couleur verdict + phrase courte (1re cause si non-vert, « Situation saine » si vert), lien `/health`. Si diagnostic indisponible : tuile grise « Santé : à configurer ».

- [ ] **Step 1: Implémenter les 3 éléments**
- [ ] **Step 2: `npx tsc --noEmit && npm run test` verts**
- [ ] **Step 3: Validation visuelle Playwright** (screenshots → `~/projects/developpeur/tmp/`), itérer avec Sylvain
- [ ] **Step 4: Commit** — `feat(health): conseils IA, réglage des seuils, tuile dashboard`

---

### Task 8: Bench modèle 30B + config + doc

**Files:**
- Modify: `backend/.env` (ajouter `OLLAMA_ADVICE_BASE_URL=http://localhost:11434` + `OLLAMA_ADVICE_MODEL=<retenu au bench>`)
- Modify: `CLAUDE.md` (section santé financière : endpoints, règle chiffres-en-code/mots-au-LLM, modèle retenu)
- Create: `~/projects/developpeur/tmp/health-bench/` (sorties du bench — jetable)

- [ ] **Step 1: Vérifier Ollama local** : `ollama list` ; puller les candidats `ollama pull qwen3:32b` et `ollama pull gemma3:27b` (~20 Go chacun, vérifier l'espace disque avant).
- [ ] **Step 2: Bench** : 3 runs par modèle sur le VRAI contexte (via `POST /api/health-check/advice` en changeant `OLLAMA_ADVICE_MODEL`), sauvegarder les 6 sorties JSON dans `tmp/health-bench/`, noter latence et VRAM (`nvidia-smi`). Critères : pertinence des priorités (TAEG chers d'abord ?), absence de chiffres inventés, français correct, latence < 90 s.
- [ ] **Step 3: Présenter les sorties à Sylvain** — il tranche le modèle.
- [ ] **Step 4: Figer `.env`, mettre à jour CLAUDE.md, commit** — `docs+chore(health): modèle conseil retenu après bench + doc module santé`
- [ ] **Step 5: Wrap-up** : suite backend complète + frontend verts, `bash local/stop.sh && bash local/run.sh`, vérification finale de la page avec Sylvain.

---

## Self-review (faite à l'écriture)

- Spec coverage : §1 indicateurs → Tasks 3-4 ; détection revenus + transition → Task 2 ; §2 architecture/endpoints/bench → Tasks 1, 4, 5, 8 ; §3 UI → Tasks 6-7 ; §4 erreurs → Tasks 4 (unavailable/reduced), 5 (fail-loud), 6 (états UI) ; §5 tests → chaque task. Hors-scope respecté (pas de notifications, pas d'historisation).
- Écart spec assumé : l'override manuel du revenu vit dans `health-thresholds.json` (`manualMonthlyIncome`) et s'édite depuis la page /health, pas depuis /income — la spec demandait « le montant confirmé à la main prime », le mécanisme est équivalent et évite de toucher la page /income.
- Types cohérents : `HealthDiagnostic`/`HealthBlockResult`/`HealthThresholds` définis Task 1, consommés Tasks 3-7 sous les mêmes noms.
