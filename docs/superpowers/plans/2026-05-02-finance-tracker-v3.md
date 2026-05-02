# Finance Tracker V3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Étendre Finance Tracker pour suivre comptes épargne (PEL, Livret A) et crédits (classiques + revolving), auto-MAJ à chaque import de relevé, avec détection Claude des charges récurrentes, mode démo isolé, et fix langue FR du dashboard.

**Architecture:** NestJS backend (modules CRUD + service `AutoSyncService` post-import + middleware `Scope.REQUEST` pour mode démo), React frontend (3 nouvelles pages, dashboard enrichi). Stockage JSON local (`data/savings-accounts.json`, `data/loans.json`, `data/loan-suggestions.json`).

**Tech Stack:** NestJS 11, React 18, TanStack Query 5, Recharts 2.13, Tailwind 3.4. Tests : Jest (unit) + Supertest (e2e).

**Spec source:** `docs/superpowers/specs/2026-05-02-finance-tracker-v3-design.md`

**Workflow exécution :**
- Sources WSL `~/projects/developpeur/finance-tracker/`, sync vers NAS via `scp -O` (cf memory `wsl_environment.md`).
- Tests unitaires : `npm test` côté backend, exécution locale WSL.
- Build/intégration : `ssh nas "cd /volume2/docker/developpeur/finance-tracker && docker compose up -d --build finance-{backend,frontend}"`.

---

## Phase 1 — Fix langue dashboard (Français)

**Pré-requis :** aucun. Phase indépendante, livrable seule.

### Task 1.1 : Réécrire les system prompts en français + descriptions d'outils

**Files:**
- Modify: `backend/src/modules/analysis/anthropic.service.ts:131,170,213,170-178,213-218`

- [ ] **Step 1 : Lire le fichier pour confirmer l'état actuel**

Run: `grep -n "system:\|description:" backend/src/modules/analysis/anthropic.service.ts`
Expected: les 2 system prompts en anglais et les `description` champs en anglais.

- [ ] **Step 2 : Modifier le `system` du phase 2 (analyse) pour exiger réponses en FR**

Dans `backend/src/modules/analysis/anthropic.service.ts`, remplacer la ligne `system: 'You are a financial health analyst. Analyze the provided transaction data and call the analyze_finances tool.',` par :

```ts
      system: "Tu es un analyste financier. Analyse les transactions fournies et appelle l'outil analyze_finances. IMPORTANT : tous les champs textuels que tu produis (analysisNarrative, claudeHealthComment, libellés des suggestions) doivent être rédigés en français. N'utilise jamais l'anglais.",
```

- [ ] **Step 3 : Modifier les descriptions des champs `analysisNarrative` et `claudeHealthComment`**

Remplacer :
```ts
      analysisNarrative: { type: 'string', description: '2-3 sentence summary' },
      claudeHealthComment: { type: 'string', description: 'Strengths and concerns' },
```
Par :
```ts
      analysisNarrative: { type: 'string', description: 'Résumé en français de 2-3 phrases (jamais en anglais)' },
      claudeHealthComment: { type: 'string', description: 'Forces et points d\'attention en français (jamais en anglais)' },
```

- [ ] **Step 4 : Modifier le `text` du message user de la phase 2 pour ajouter consigne FR**

Localiser la ligne contenant `Identify recurring credits, compute score factors, and write a financial health assessment.` et la remplacer par :

```ts
        content: `Banque : ${p1.bankName}\nPériode : ${period.month}/${period.year}\nDevise : ${p1.currency}\nSolde initial : ${p1.openingBalance}\nSolde final : ${p1.closingBalance}\n\nTransactions :\n${txSummary}\n\nIdentifie les crédits récurrents, calcule les facteurs de score, et rédige un bilan de santé financière en français.`,
```

- [ ] **Step 5 : Build TypeScript local pour valider**

Run: `cd backend && npx tsc --noEmit -p tsconfig.json`
Expected: pas d'erreur.

- [ ] **Step 6 : Commit**

```bash
git add backend/src/modules/analysis/anthropic.service.ts
git commit -m "feat(analysis): force Claude to respond in French in phase 2"
```

### Task 1.2 : Endpoint `POST /api/statements/:id/reanalyze` pour re-traiter un statement existant

**Files:**
- Modify: `backend/src/modules/statements/statements.controller.ts`
- Modify: `backend/src/modules/statements/statements.module.ts`
- Modify: `backend/src/modules/analysis/analysis.service.ts`

- [ ] **Step 1 : Ajouter méthode `reanalyzeStatement` au service Analysis**

Ajouter après `analyzeAndPersist` dans `backend/src/modules/analysis/analysis.service.ts` :

```ts
  async reanalyzeStatement(id: string, pdfBuffer: Buffer): Promise<AnalysisResponse> {
    // Re-traite un statement existant avec le prompt FR actuel.
    // Utilisé pour migrer les anciens commentaires anglais vers le français.
    const existing = await this.storage.getStatement(id);
    if (!existing) throw new Error(`Statement ${id} introuvable`);
    return this.analyzeAndPersist(pdfBuffer);
  }
```

> Note : la signature exige le `pdfBuffer` car la phase 1 a besoin du PDF source. Côté front on demandera à l'utilisateur de re-uploader le PDF du mois concerné.

- [ ] **Step 2 : Exposer la méthode dans le controller**

Dans `backend/src/modules/statements/statements.controller.ts`, ajouter en haut les imports :

```ts
import { Body, Controller, Delete, Get, NotFoundException, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AnalysisService } from '../analysis/analysis.service';
```

Ajouter `private readonly analysis: AnalysisService` au constructor :

```ts
  constructor(
    private readonly storage: StorageService,
    private readonly snapshots: SnapshotService,
    private readonly analysis: AnalysisService,
  ) {}
```

Et la nouvelle route :

```ts
  @Post(':id/reanalyze')
  @UseInterceptors(FileInterceptor('file'))
  async reanalyze(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new NotFoundException('PDF requis pour re-analyser');
    return this.analysis.reanalyzeStatement(id, file.buffer);
  }
```

- [ ] **Step 3 : Importer AnalysisModule dans StatementsModule**

Modifier `backend/src/modules/statements/statements.module.ts` :

```ts
import { Module } from '@nestjs/common';
import { StatementsController } from './statements.controller';
import { AnalysisModule } from '../analysis/analysis.module';
import { StorageModule } from '../storage/storage.module';
import { SnapshotsModule } from '../snapshots/snapshots.module';

@Module({
  imports: [AnalysisModule, StorageModule, SnapshotsModule],
  controllers: [StatementsController],
})
export class StatementsModule {}
```

- [ ] **Step 4 : Vérifier que AnalysisModule exporte AnalysisService**

Run: `grep -n "exports" backend/src/modules/analysis/analysis.module.ts`
Si pas exporté, ajouter `exports: [AnalysisService]` dans le décorateur `@Module`.

- [ ] **Step 5 : Build TypeScript**

Run: `cd backend && npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add backend/src/modules/{statements,analysis}
git commit -m "feat(statements): add POST /:id/reanalyze for FR migration"
```

### Task 1.3 : Bouton "Re-analyser en FR" dans la page statement detail

**Files:**
- Modify: `frontend/src/lib/queries.ts`
- Modify: `frontend/src/lib/api.ts` (ajout helper)
- Modify: `frontend/src/routes/statement.$id.tsx`

- [ ] **Step 1 : Ajouter un helper `postFormFile` dans `frontend/src/lib/api.ts`**

Ajouter au-dessus de l'export `api` (note : `postForm` existe déjà, on ajoute juste un alias sémantique pour 1 seul fichier — facultatif, on peut réutiliser `postForm` direct). Skip si tu préfères.

- [ ] **Step 2 : Ajouter mutation `useReanalyzeStatement` dans `frontend/src/lib/queries.ts`**

Ajouter à la fin du fichier :

```ts
export function useReanalyzeStatement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const form = new FormData();
      form.append('file', file);
      return api.postForm<MonthlyStatement>(`/statements/${id}/reanalyze`, form);
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: qk.statement(vars.id) });
      qc.invalidateQueries({ queryKey: qk.statements() });
      qc.invalidateQueries({ queryKey: qk.scoreHistory() });
    },
  });
}
```

- [ ] **Step 3 : Ajouter bouton "Re-analyser en FR" dans `routes/statement.$id.tsx`**

Lire le fichier d'abord :
Run: `wc -l frontend/src/routes/statement.$id.tsx`

Repérer où est rendu le `claudeComment`. Ajouter à côté du commentaire un bouton conditionnel :

```tsx
const reanalyze = useReanalyzeStatement();

const handleReanalyze = () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/pdf';
  input.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file && id) await reanalyze.mutateAsync({ id, file });
  };
  input.click();
};

// Près du claudeComment :
{statement.healthScore.claudeComment && /[a-zA-Z]{4,}/.test(statement.healthScore.claudeComment.split(' ').filter(w => /^(the|and|with|your|that)$/i.test(w)).join('')) && (
  <button onClick={handleReanalyze} className="btn-ghost text-xs">
    Re-analyser en français (re-upload du PDF)
  </button>
)}
```

> Pragmatisme : ne pas s'embêter à détecter automatiquement la langue, afficher le bouton tout le temps. Plus simple :

```tsx
<button onClick={handleReanalyze} disabled={reanalyze.isPending} className="btn-ghost text-xs mt-2">
  {reanalyze.isPending ? 'Re-analyse en cours…' : 'Re-analyser ce relevé en français'}
</button>
```

- [ ] **Step 4 : Vérifier le build frontend local**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add frontend/src/{lib/queries.ts,routes/statement.$id.tsx}
git commit -m "feat(ui): add reanalyze button on statement detail for FR migration"
```

### Task 1.4 : Tester end-to-end Phase 1

- [ ] **Step 1 : Sync sur NAS et build**

Run:
```bash
rsync -av --delete backend/src/ nas:/volume2/docker/developpeur/finance-tracker/backend/src/
rsync -av --delete frontend/src/ nas:/volume2/docker/developpeur/finance-tracker/frontend/src/
ssh nas "cd /volume2/docker/developpeur/finance-tracker && docker compose up -d --build --force-recreate --no-deps finance-backend finance-frontend"
```

Expected: build OK, containers up.

- [ ] **Step 2 : Vérifier dans le navigateur**

Ouvre http://nas:4200, login, importer un nouveau PDF de relevé. Vérifier que `claudeComment` est en français.

- [ ] **Step 3 : Si OK, marquer Phase 1 comme terminée**

```bash
git tag v3-phase1-done
```

---

## Phase 2 — Comptes épargne (backend + frontend)

**Pré-requis :** Phase 1 (pas obligatoire, mais conseillé). Phase indépendante de Phase 3.

### File Structure

| Path | Responsabilité |
|------|----------------|
| `backend/src/models/savings-account.model.ts` | Types + interfaces SavingsAccount, SavingsMovement |
| `backend/src/modules/savings/savings.module.ts` | Wiring NestJS |
| `backend/src/modules/savings/savings.service.ts` | CRUD comptes + mouvements + calcul intérêts |
| `backend/src/modules/savings/savings.controller.ts` | Endpoints REST |
| `backend/src/modules/savings/savings.service.spec.ts` | Tests unit |
| `backend/src/modules/savings/dto/savings-account.dto.ts` | DTO + validation |
| `frontend/src/types/api.ts` | Ajout types côté front |
| `frontend/src/lib/queries.ts` | Hooks TanStack Query |
| `frontend/src/routes/savings.tsx` | Page liste + form |
| `frontend/src/router.tsx` | Route `/savings` |
| `frontend/src/components/layout/sidebar.tsx` | Item nav |

### Task 2.1 : Créer le modèle SavingsAccount

**Files:**
- Create: `backend/src/models/savings-account.model.ts`

- [ ] **Step 1 : Créer le fichier modèle**

```ts
export type SavingsAccountType = 'livret-a' | 'pel' | 'cel' | 'ldds' | 'pea' | 'other';

export type SavingsMovementSource = 'initial' | 'detected' | 'manual' | 'interest';

export interface SavingsMovement {
  id: string;
  date: string;
  amount: number;
  source: SavingsMovementSource;
  statementId: string | null;
  transactionId: string | null;
  note?: string;
}

export interface SavingsAccount {
  id: string;
  name: string;
  type: SavingsAccountType;
  initialBalance: number;
  initialBalanceDate: string;
  matchPattern: string;
  interestRate: number;
  interestAnniversaryMonth: number;
  currentBalance: number;
  lastSyncedStatementId: string | null;
  movements: SavingsMovement[];
  createdAt: string;
  updatedAt: string;
}

export type SavingsAccountInput = Omit<
  SavingsAccount,
  'id' | 'currentBalance' | 'lastSyncedStatementId' | 'movements' | 'createdAt' | 'updatedAt'
>;

export interface BalanceHistoryEntry {
  month: string;
  balance: number;
}
```

- [ ] **Step 2 : Commit**

```bash
git add backend/src/models/savings-account.model.ts
git commit -m "feat(savings): add SavingsAccount model"
```

### Task 2.2 : DTO de validation

**Files:**
- Create: `backend/src/modules/savings/dto/savings-account.dto.ts`

- [ ] **Step 1 : Créer le DTO**

```ts
import { BadRequestException } from '@nestjs/common';
import type { SavingsAccountInput, SavingsAccountType } from '../../../models/savings-account.model';

const VALID_TYPES: SavingsAccountType[] = ['livret-a', 'pel', 'cel', 'ldds', 'pea', 'other'];

export function validateSavingsAccountInput(raw: unknown): SavingsAccountInput {
  if (!raw || typeof raw !== 'object') throw new BadRequestException('Body invalide');
  const r = raw as Record<string, unknown>;

  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (!name) throw new BadRequestException('Nom requis');

  const type = r.type as SavingsAccountType;
  if (!VALID_TYPES.includes(type)) throw new BadRequestException(`Type invalide (${type})`);

  const initialBalance = Number(r.initialBalance);
  if (!Number.isFinite(initialBalance)) throw new BadRequestException('initialBalance invalide');

  const initialBalanceDate = typeof r.initialBalanceDate === 'string' ? r.initialBalanceDate : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(initialBalanceDate)) {
    throw new BadRequestException('initialBalanceDate doit être YYYY-MM-DD');
  }

  const matchPattern = typeof r.matchPattern === 'string' ? r.matchPattern.trim() : '';
  if (matchPattern) {
    try { new RegExp(matchPattern, 'i'); } catch {
      throw new BadRequestException(`matchPattern n'est pas un regex valide: ${matchPattern}`);
    }
  }

  const interestRate = Number(r.interestRate);
  if (!Number.isFinite(interestRate) || interestRate < 0 || interestRate > 0.5) {
    throw new BadRequestException('interestRate hors plage [0, 0.5]');
  }

  const anniv = Number(r.interestAnniversaryMonth);
  if (!Number.isInteger(anniv) || anniv < 1 || anniv > 12) {
    throw new BadRequestException('interestAnniversaryMonth doit être un entier 1-12');
  }

  return {
    name,
    type,
    initialBalance,
    initialBalanceDate,
    matchPattern,
    interestRate,
    interestAnniversaryMonth: anniv,
  };
}
```

- [ ] **Step 2 : Commit**

```bash
git add backend/src/modules/savings/dto/savings-account.dto.ts
git commit -m "feat(savings): add input validation DTO"
```

### Task 2.3 : Test unit du service savings — création + listing

**Files:**
- Create: `backend/src/modules/savings/savings.service.spec.ts`

- [ ] **Step 1 : Écrire le test (failing)**

```ts
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SavingsService } from './savings.service';
import { EventBusService } from '../events/event-bus.service';

describe('SavingsService', () => {
  let svc: SavingsService;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-savings-'));
    const mod = await Test.createTestingModule({
      providers: [
        SavingsService,
        { provide: ConfigService, useValue: { get: (k: string) => k === 'dataDir' ? tmpDir : null } },
        { provide: EventBusService, useValue: { emit: jest.fn() } },
      ],
    }).compile();
    svc = mod.get(SavingsService);
    await svc.onModuleInit();
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('starts with empty list', async () => {
    expect(await svc.getAll()).toEqual([]);
  });

  it('creates a savings account with initial balance movement', async () => {
    const acc = await svc.create({
      name: 'Livret A',
      type: 'livret-a',
      initialBalance: 201.55,
      initialBalanceDate: '2026-05-01',
      matchPattern: 'VIR.*LIVRET',
      interestRate: 0.015,
      interestAnniversaryMonth: 12,
    });
    expect(acc.id).toBeDefined();
    expect(acc.currentBalance).toBe(201.55);
    expect(acc.movements).toHaveLength(1);
    expect(acc.movements[0].source).toBe('initial');
    expect(acc.movements[0].amount).toBe(201.55);
  });
});
```

- [ ] **Step 2 : Vérifier que le test échoue**

Run: `cd backend && npm test -- savings.service.spec`
Expected: FAIL — module SavingsService introuvable.

### Task 2.4 : Implémenter SavingsService (CRUD basique)

**Files:**
- Create: `backend/src/modules/savings/savings.service.ts`

- [ ] **Step 1 : Implémenter**

```ts
import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  BalanceHistoryEntry,
  SavingsAccount,
  SavingsAccountInput,
  SavingsMovement,
  SavingsMovementSource,
} from '../../models/savings-account.model';
import { EventBusService } from '../events/event-bus.service';

@Injectable()
export class SavingsService implements OnModuleInit {
  private readonly logger = new Logger(SavingsService.name);
  private filepath!: string;

  constructor(
    private readonly config: ConfigService,
    private readonly bus: EventBusService,
  ) {}

  onModuleInit() {
    this.filepath = path.resolve(this.config.get<string>('dataDir')!, 'savings-accounts.json');
  }

  async getAll(): Promise<SavingsAccount[]> {
    try {
      const content = await fs.promises.readFile(this.filepath, 'utf8');
      return JSON.parse(content) as SavingsAccount[];
    } catch {
      return [];
    }
  }

  async getOne(id: string): Promise<SavingsAccount> {
    const all = await this.getAll();
    const acc = all.find((a) => a.id === id);
    if (!acc) throw new NotFoundException(`Compte épargne ${id} introuvable`);
    return acc;
  }

  async create(input: SavingsAccountInput): Promise<SavingsAccount> {
    const all = await this.getAll();
    const now = new Date().toISOString();
    const initialMovement: SavingsMovement = {
      id: randomUUID(),
      date: input.initialBalanceDate,
      amount: input.initialBalance,
      source: 'initial',
      statementId: null,
      transactionId: null,
      note: 'Solde initial déclaré',
    };
    const acc: SavingsAccount = {
      ...input,
      id: randomUUID(),
      currentBalance: input.initialBalance,
      lastSyncedStatementId: null,
      movements: [initialMovement],
      createdAt: now,
      updatedAt: now,
    };
    all.push(acc);
    await this.persist(all);
    this.logger.log(`Created savings account ${acc.id} (${acc.name})`);
    return acc;
  }

  async update(id: string, input: SavingsAccountInput): Promise<SavingsAccount> {
    const all = await this.getAll();
    const idx = all.findIndex((a) => a.id === id);
    if (idx === -1) throw new NotFoundException(`Compte épargne ${id} introuvable`);
    all[idx] = {
      ...all[idx],
      ...input,
      id: all[idx].id,
      currentBalance: all[idx].currentBalance,
      movements: all[idx].movements,
      lastSyncedStatementId: all[idx].lastSyncedStatementId,
      createdAt: all[idx].createdAt,
      updatedAt: new Date().toISOString(),
    };
    await this.persist(all);
    return all[idx];
  }

  async delete(id: string): Promise<void> {
    const all = await this.getAll();
    const next = all.filter((a) => a.id !== id);
    if (next.length === all.length) throw new NotFoundException(`Compte épargne ${id} introuvable`);
    await this.persist(next);
  }

  async addMovement(
    id: string,
    movement: { date: string; amount: number; source: SavingsMovementSource; statementId?: string | null; transactionId?: string | null; note?: string },
  ): Promise<SavingsAccount> {
    const all = await this.getAll();
    const idx = all.findIndex((a) => a.id === id);
    if (idx === -1) throw new NotFoundException(`Compte épargne ${id} introuvable`);
    const mv: SavingsMovement = {
      id: randomUUID(),
      date: movement.date,
      amount: movement.amount,
      source: movement.source,
      statementId: movement.statementId ?? null,
      transactionId: movement.transactionId ?? null,
      note: movement.note,
    };
    all[idx].movements.push(mv);
    all[idx].currentBalance = Math.round((all[idx].currentBalance + movement.amount) * 100) / 100;
    all[idx].updatedAt = new Date().toISOString();
    await this.persist(all);
    return all[idx];
  }

  async getBalanceHistory(id: string, months = 12): Promise<BalanceHistoryEntry[]> {
    const acc = await this.getOne(id);
    const sorted = [...acc.movements].sort((a, b) => a.date.localeCompare(b.date));
    const now = new Date();
    const result: BalanceHistoryEntry[] = [];
    let running = 0;
    let cursor = 0;
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const monthEndStr = monthEnd.toISOString().slice(0, 10);
      while (cursor < sorted.length && sorted[cursor].date <= monthEndStr) {
        running += sorted[cursor].amount;
        cursor++;
      }
      result.push({
        month: d.toISOString().slice(0, 7),
        balance: Math.round(running * 100) / 100,
      });
    }
    return result;
  }

  private async persist(all: SavingsAccount[]): Promise<void> {
    await fs.promises.writeFile(this.filepath, JSON.stringify(all, null, 2), 'utf8');
    this.bus.emit('savings-changed');
  }
}
```

- [ ] **Step 2 : Run le test**

Run: `cd backend && npm test -- savings.service.spec`
Expected: PASS (2 tests).

- [ ] **Step 3 : Commit**

```bash
git add backend/src/modules/savings/savings.service{,.spec}.ts
git commit -m "feat(savings): implement CRUD + addMovement + balanceHistory"
```

### Task 2.5 : Test additionnel — addMovement met à jour la balance

- [ ] **Step 1 : Ajouter le test**

Dans `savings.service.spec.ts`, ajouter :

```ts
  it('addMovement updates currentBalance and history', async () => {
    const acc = await svc.create({
      name: 'PEL',
      type: 'pel',
      initialBalance: 1000,
      initialBalanceDate: '2026-01-01',
      matchPattern: 'VIR.*PEL',
      interestRate: 0.02,
      interestAnniversaryMonth: 6,
    });
    const updated = await svc.addMovement(acc.id, {
      date: '2026-02-15',
      amount: 100,
      source: 'detected',
      statementId: '2026-02',
      transactionId: 'tx-1',
    });
    expect(updated.currentBalance).toBe(1100);
    expect(updated.movements).toHaveLength(2);
  });

  it('balanceHistory reflects movements over months', async () => {
    const acc = await svc.create({
      name: 'PEL',
      type: 'pel',
      initialBalance: 0,
      initialBalanceDate: '2026-01-01',
      matchPattern: '',
      interestRate: 0.02,
      interestAnniversaryMonth: 6,
    });
    await svc.addMovement(acc.id, { date: '2026-01-15', amount: 100, source: 'detected' });
    await svc.addMovement(acc.id, { date: '2026-03-15', amount: 200, source: 'detected' });
    const hist = await svc.getBalanceHistory(acc.id, 12);
    expect(hist).toHaveLength(12);
    const jan = hist.find((h) => h.month === '2026-01');
    const feb = hist.find((h) => h.month === '2026-02');
    const mar = hist.find((h) => h.month === '2026-03');
    expect(jan!.balance).toBe(100);
    expect(feb!.balance).toBe(100);
    expect(mar!.balance).toBe(300);
  });
```

- [ ] **Step 2 : Run et commit**

Run: `cd backend && npm test -- savings.service.spec`
Expected: PASS (4 tests).

```bash
git add backend/src/modules/savings/savings.service.spec.ts
git commit -m "test(savings): cover addMovement and balanceHistory"
```

### Task 2.6 : Controller + module

**Files:**
- Create: `backend/src/modules/savings/savings.controller.ts`
- Create: `backend/src/modules/savings/savings.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1 : Créer le controller**

```ts
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { SavingsService } from './savings.service';
import { validateSavingsAccountInput } from './dto/savings-account.dto';

@Controller('savings-accounts')
export class SavingsController {
  constructor(private readonly svc: SavingsService) {}

  @Get()
  list() { return this.svc.getAll(); }

  @Get(':id')
  one(@Param('id') id: string) { return this.svc.getOne(id); }

  @Post()
  create(@Body() body: unknown) { return this.svc.create(validateSavingsAccountInput(body)); }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.svc.update(id, validateSavingsAccountInput(body));
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id') id: string): Promise<void> { await this.svc.delete(id); }

  @Post(':id/movements')
  addMovement(@Param('id') id: string, @Body() body: { date: string; amount: number; note?: string }) {
    return this.svc.addMovement(id, {
      date: body.date,
      amount: Number(body.amount),
      source: 'manual',
      note: body.note,
    });
  }

  @Get(':id/balance-history')
  history(@Param('id') id: string, @Query('months') months?: string) {
    return this.svc.getBalanceHistory(id, months ? parseInt(months, 10) : 12);
  }
}
```

- [ ] **Step 2 : Créer le module**

```ts
import { Module } from '@nestjs/common';
import { SavingsController } from './savings.controller';
import { SavingsService } from './savings.service';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [EventsModule],
  controllers: [SavingsController],
  providers: [SavingsService],
  exports: [SavingsService],
})
export class SavingsModule {}
```

- [ ] **Step 3 : Wiring dans AppModule**

Ajouter `SavingsModule` à l'array `imports` de `app.module.ts`, et l'import en haut.

- [ ] **Step 4 : Build TS et commit**

Run: `cd backend && npx tsc --noEmit -p tsconfig.json`

```bash
git add backend/src/modules/savings/{savings.controller.ts,savings.module.ts} backend/src/app.module.ts
git commit -m "feat(savings): wire controller + module + AppModule"
```

### Task 2.7 : Frontend — types + queries

**Files:**
- Modify: `frontend/src/types/api.ts`
- Modify: `frontend/src/lib/queries.ts`

- [ ] **Step 1 : Ajouter types dans `frontend/src/types/api.ts`**

Append :

```ts
export type SavingsAccountType = 'livret-a' | 'pel' | 'cel' | 'ldds' | 'pea' | 'other';

export const SAVINGS_TYPE_LABELS: Record<SavingsAccountType, string> = {
  'livret-a': 'Livret A',
  pel: 'PEL',
  cel: 'CEL',
  ldds: 'LDDS',
  pea: 'PEA',
  other: 'Autre',
};

export interface SavingsMovement {
  id: string;
  date: string;
  amount: number;
  source: 'initial' | 'detected' | 'manual' | 'interest';
  statementId: string | null;
  transactionId: string | null;
  note?: string;
}

export interface SavingsAccount {
  id: string;
  name: string;
  type: SavingsAccountType;
  initialBalance: number;
  initialBalanceDate: string;
  matchPattern: string;
  interestRate: number;
  interestAnniversaryMonth: number;
  currentBalance: number;
  lastSyncedStatementId: string | null;
  movements: SavingsMovement[];
  createdAt: string;
  updatedAt: string;
}

export type SavingsAccountInput = Omit<
  SavingsAccount,
  'id' | 'currentBalance' | 'lastSyncedStatementId' | 'movements' | 'createdAt' | 'updatedAt'
>;

export interface BalanceHistoryEntry {
  month: string;
  balance: number;
}
```

- [ ] **Step 2 : Ajouter hooks dans `frontend/src/lib/queries.ts`**

Append :

```ts
import type { SavingsAccount, SavingsAccountInput, BalanceHistoryEntry } from '@/types/api';

export const qkSavings = {
  all: () => ['savings'] as const,
  one: (id: string) => ['savings', id] as const,
  history: (id: string, months: number) => ['savings', id, 'history', months] as const,
};

export function useSavingsAccounts() {
  return useQuery({ queryKey: qkSavings.all(), queryFn: () => api.get<SavingsAccount[]>('/savings-accounts') });
}

export function useSavingsAccount(id: string | undefined) {
  return useQuery({
    queryKey: qkSavings.one(id ?? ''),
    queryFn: () => api.get<SavingsAccount>(`/savings-accounts/${id}`),
    enabled: !!id,
  });
}

export function useSavingsHistory(id: string | undefined, months = 12) {
  return useQuery({
    queryKey: qkSavings.history(id ?? '', months),
    queryFn: () => api.get<BalanceHistoryEntry[]>(`/savings-accounts/${id}/balance-history?months=${months}`),
    enabled: !!id,
  });
}

export function useCreateSavingsAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SavingsAccountInput) => api.post<SavingsAccount>('/savings-accounts', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qkSavings.all() }),
  });
}

export function useUpdateSavingsAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: SavingsAccountInput }) =>
      api.put<SavingsAccount>(`/savings-accounts/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qkSavings.all() }),
  });
}

export function useDeleteSavingsAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/savings-accounts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qkSavings.all() }),
  });
}

export function useAddSavingsMovement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: { date: string; amount: number; note?: string } }) =>
      api.post<SavingsAccount>(`/savings-accounts/${id}/movements`, body),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: qkSavings.all() });
      qc.invalidateQueries({ queryKey: qkSavings.one(vars.id) });
    },
  });
}
```

- [ ] **Step 3 : Build TS et commit**

Run: `cd frontend && npx tsc -b --noEmit`

```bash
git add frontend/src/{types/api.ts,lib/queries.ts}
git commit -m "feat(savings): add frontend types and TanStack hooks"
```

### Task 2.8 : Frontend — page `/savings`

**Files:**
- Create: `frontend/src/routes/savings.tsx`
- Modify: `frontend/src/router.tsx`
- Modify: `frontend/src/components/layout/sidebar.tsx`

- [ ] **Step 1 : Créer la page**

```tsx
import { useState } from 'react';
import { Plus, PiggyBank, Pencil, Trash2, X } from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import {
  useSavingsAccounts,
  useCreateSavingsAccount,
  useUpdateSavingsAccount,
  useDeleteSavingsAccount,
  useSavingsHistory,
} from '@/lib/queries';
import { PageHeader } from '@/components/page-header';
import { LoadingState, EmptyState } from '@/components/loading-state';
import {
  type SavingsAccount,
  type SavingsAccountInput,
  type SavingsAccountType,
  SAVINGS_TYPE_LABELS,
} from '@/types/api';
import { formatEUR } from '@/lib/utils';

const TYPES: SavingsAccountType[] = ['livret-a', 'pel', 'cel', 'ldds', 'pea', 'other'];

const DEFAULT: SavingsAccountInput = {
  name: '',
  type: 'livret-a',
  initialBalance: 0,
  initialBalanceDate: new Date().toISOString().slice(0, 10),
  matchPattern: '',
  interestRate: 0.015,
  interestAnniversaryMonth: 12,
};

export function SavingsPage() {
  const { data, isLoading } = useSavingsAccounts();
  const create = useCreateSavingsAccount();
  const update = useUpdateSavingsAccount();
  const remove = useDeleteSavingsAccount();
  const [editing, setEditing] = useState<SavingsAccount | null>(null);
  const [creating, setCreating] = useState(false);

  if (isLoading) return <LoadingState />;
  const items = data ?? [];
  const total = items.reduce((s, a) => s + a.currentBalance, 0);

  const handleSave = async (input: SavingsAccountInput) => {
    if (editing) await update.mutateAsync({ id: editing.id, input });
    else await create.mutateAsync(input);
    setEditing(null);
    setCreating(false);
  };

  return (
    <>
      <PageHeader
        eyebrow="Comptes épargne"
        title={formatEUR(total)}
        subtitle={`${items.length} compte${items.length > 1 ? 's' : ''} suivi${items.length > 1 ? 's' : ''}`}
        actions={
          <button onClick={() => { setCreating(true); setEditing(null); }} className="btn-primary">
            <Plus className="h-4 w-4" /> Ajouter un compte
          </button>
        }
      />
      {items.length === 0 ? (
        <EmptyState title="Aucun compte épargne déclaré" hint="Commence par déclarer ton Livret A ou ton PEL." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map((acc) => (
            <SavingsCard
              key={acc.id}
              account={acc}
              onEdit={() => { setEditing(acc); setCreating(false); }}
              onDelete={() => confirm(`Supprimer "${acc.name}" ?`) && remove.mutate(acc.id)}
            />
          ))}
        </div>
      )}
      {(creating || editing) && (
        <SavingsForm
          init={editing ? toInput(editing) : DEFAULT}
          onSave={handleSave}
          onCancel={() => { setCreating(false); setEditing(null); }}
          busy={create.isPending || update.isPending}
        />
      )}
    </>
  );
}

function toInput(a: SavingsAccount): SavingsAccountInput {
  return {
    name: a.name,
    type: a.type,
    initialBalance: a.initialBalance,
    initialBalanceDate: a.initialBalanceDate,
    matchPattern: a.matchPattern,
    interestRate: a.interestRate,
    interestAnniversaryMonth: a.interestAnniversaryMonth,
  };
}

function SavingsCard({ account, onEdit, onDelete }: { account: SavingsAccount; onEdit: () => void; onDelete: () => void }) {
  const { data: hist } = useSavingsHistory(account.id, 12);
  const lastDelta = account.movements.length >= 2
    ? account.movements[account.movements.length - 1].amount
    : 0;
  return (
    <div className="card p-5 flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <PiggyBank className="h-4 w-4 text-accent" />
          <div>
            <div className="font-display font-semibold text-fg-bright">{account.name}</div>
            <div className="text-xs text-fg-dim">{SAVINGS_TYPE_LABELS[account.type]} · {(account.interestRate * 100).toFixed(2)}%</div>
          </div>
        </div>
        <div className="flex gap-1">
          <button onClick={onEdit} className="btn-ghost p-1.5"><Pencil className="h-3.5 w-3.5" /></button>
          <button onClick={onDelete} className="btn-ghost p-1.5 hover:text-negative"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <div className="mt-4 font-display tabular text-3xl font-bold text-fg-bright">{formatEUR(account.currentBalance)}</div>
      {lastDelta !== 0 && (
        <div className={lastDelta > 0 ? 'text-xs text-positive mt-1' : 'text-xs text-negative mt-1'}>
          {lastDelta > 0 ? '↑' : '↓'} {formatEUR(Math.abs(lastDelta))} dernier mouvement
        </div>
      )}
      {hist && hist.length > 1 && (
        <div className="h-12 mt-3 -mx-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={hist}>
              <defs>
                <linearGradient id={`grad-${account.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(160 84% 50%)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(160 84% 50%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="balance" stroke="hsl(160 84% 50%)" strokeWidth={1.5} fill={`url(#grad-${account.id})`} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function SavingsForm({ init, onSave, onCancel, busy }: { init: SavingsAccountInput; onSave: (i: SavingsAccountInput) => void; onCancel: () => void; busy: boolean }) {
  const [form, setForm] = useState<SavingsAccountInput>(init);
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" onClick={onCancel}>
      <div className="card max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-display font-semibold text-fg-bright">{init.name ? 'Modifier le compte' : 'Nouveau compte épargne'}</h2>
          <button onClick={onCancel} className="btn-ghost p-1"><X className="h-4 w-4" /></button>
        </div>
        <form className="p-5 space-y-3" onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
          <Field label="Nom"><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as SavingsAccountType })}>
                {TYPES.map((t) => <option key={t} value={t}>{SAVINGS_TYPE_LABELS[t]}</option>)}
              </select>
            </Field>
            <Field label="Taux d'intérêt (%)">
              <input className="input tabular" type="number" step="0.01" required value={form.interestRate * 100}
                     onChange={(e) => setForm({ ...form, interestRate: Number(e.target.value) / 100 })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Solde initial (€)">
              <input className="input tabular" type="number" step="0.01" required value={form.initialBalance}
                     onChange={(e) => setForm({ ...form, initialBalance: Number(e.target.value) })} />
            </Field>
            <Field label="Date du solde">
              <input className="input" type="date" required value={form.initialBalanceDate}
                     onChange={(e) => setForm({ ...form, initialBalanceDate: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mois anniversaire intérêts (1-12)">
              <input className="input tabular" type="number" min={1} max={12} required value={form.interestAnniversaryMonth}
                     onChange={(e) => setForm({ ...form, interestAnniversaryMonth: Number(e.target.value) })} />
            </Field>
            <Field label="Pattern de détection (regex)">
              <input className="input font-mono text-xs" placeholder="VIR.*PEL" value={form.matchPattern}
                     onChange={(e) => setForm({ ...form, matchPattern: e.target.value })} />
            </Field>
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onCancel} className="btn-secondary">Annuler</button>
            <button type="submit" disabled={busy} className="btn-primary">Enregistrer</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="stat-label block mb-1.5">{label}</span>{children}</label>;
}
```

- [ ] **Step 2 : Enregistrer la route dans `router.tsx`**

Ajouter import :
```tsx
import { SavingsPage } from './routes/savings';
```

Ajouter route :
```tsx
const savingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/savings',
  component: SavingsPage,
});
```

L'ajouter au `routeTree.addChildren([..., savingsRoute, ...])`.

- [ ] **Step 3 : Ajouter dans `sidebar.tsx`**

Importer l'icône :
```tsx
import { LayoutDashboard, History, Wallet, Repeat, ListChecks, CalendarRange, CalendarDays, Upload, Info, LogOut, PiggyBank } from 'lucide-react';
```

Ajouter dans `NAV_ITEMS` après `budget` :
```tsx
{ to: '/savings', label: 'Comptes épargne', icon: PiggyBank, exact: false },
```

- [ ] **Step 4 : Build TS et commit**

Run: `cd frontend && npx tsc -b --noEmit`

```bash
git add frontend/src/{routes/savings.tsx,router.tsx,components/layout/sidebar.tsx}
git commit -m "feat(savings): add /savings page with cards + form"
```

### Task 2.9 : Tester end-to-end Phase 2

- [ ] **Step 1 : Sync NAS + build**

Run:
```bash
rsync -av --delete backend/src/ nas:/volume2/docker/developpeur/finance-tracker/backend/src/
rsync -av --delete frontend/src/ nas:/volume2/docker/developpeur/finance-tracker/frontend/src/
ssh nas "cd /volume2/docker/developpeur/finance-tracker && docker compose up -d --build --force-recreate --no-deps finance-backend finance-frontend"
```

- [ ] **Step 2 : Vérifier dans le navigateur**

Ouvre http://nas:4200/savings, créer un Livret A à 201,55 € avec pattern `VIR.*LIVRET`, taux 1,5 %, anniversaire 12. Vérifier que la carte s'affiche avec le bon montant.

- [ ] **Step 3 : Tag**

```bash
git tag v3-phase2-done
```

---

## Phase 3 — Crédits (backend + frontend)

**Pré-requis :** aucun (indépendante de Phase 2). Architecture identique : module CRUD + page front avec 2 sections (classique / revolving).

### File Structure

| Path | Responsabilité |
|------|----------------|
| `backend/src/models/loan.model.ts` | Types Loan, LoanOccurrence |
| `backend/src/modules/loans/dto/loan.dto.ts` | Validation + différenciation classic/revolving |
| `backend/src/modules/loans/loans.service.ts` | CRUD + reset revolving + addOccurrence |
| `backend/src/modules/loans/loans.controller.ts` | Endpoints REST |
| `backend/src/modules/loans/loans.module.ts` | Wiring |
| `backend/src/modules/loans/loans.service.spec.ts` | Tests unit |
| `frontend/src/types/api.ts` | Types front (append) |
| `frontend/src/lib/queries.ts` | Hooks (append) |
| `frontend/src/routes/loans.tsx` | Page liste + form |
| `frontend/src/router.tsx` | Route `/loans` |
| `frontend/src/components/layout/sidebar.tsx` | Item nav |

### Task 3.1 : Modèle Loan

**Files:**
- Create: `backend/src/models/loan.model.ts`

- [ ] **Step 1 : Écrire**

```ts
export type LoanType = 'classic' | 'revolving';
export type LoanCategory = 'mortgage' | 'consumer' | 'auto' | 'student' | 'other';

export interface LoanOccurrence {
  id: string;
  statementId: string;
  date: string;
  amount: number;
  transactionId: string | null;
}

export interface Loan {
  id: string;
  name: string;
  type: LoanType;
  category: LoanCategory;
  monthlyPayment: number;
  matchPattern: string;
  isActive: boolean;
  // Classic
  startDate?: string;
  endDate?: string;
  initialPrincipal?: number;
  // Revolving
  maxAmount?: number;
  usedAmount?: number;
  lastManualResetAt?: string;
  // Tracking
  occurrencesDetected: LoanOccurrence[];
  createdAt: string;
  updatedAt: string;
}

export type LoanInput = Omit<Loan, 'id' | 'occurrencesDetected' | 'createdAt' | 'updatedAt'>;
```

- [ ] **Step 2 : Commit**
```bash
git add backend/src/models/loan.model.ts
git commit -m "feat(loans): add Loan model"
```

### Task 3.2 : DTO de validation (différencie classic/revolving)

**Files:**
- Create: `backend/src/modules/loans/dto/loan.dto.ts`

- [ ] **Step 1 : Écrire**

```ts
import { BadRequestException } from '@nestjs/common';
import type { LoanCategory, LoanInput, LoanType } from '../../../models/loan.model';

const VALID_TYPES: LoanType[] = ['classic', 'revolving'];
const VALID_CATEGORIES: LoanCategory[] = ['mortgage', 'consumer', 'auto', 'student', 'other'];

export function validateLoanInput(raw: unknown): LoanInput {
  if (!raw || typeof raw !== 'object') throw new BadRequestException('Body invalide');
  const r = raw as Record<string, unknown>;

  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (!name) throw new BadRequestException('Nom requis');

  const type = r.type as LoanType;
  if (!VALID_TYPES.includes(type)) throw new BadRequestException(`Type invalide (${type})`);

  const category = r.category as LoanCategory;
  if (!VALID_CATEGORIES.includes(category)) throw new BadRequestException(`Catégorie invalide (${category})`);

  const monthlyPayment = Number(r.monthlyPayment);
  if (!Number.isFinite(monthlyPayment) || monthlyPayment < 0) throw new BadRequestException('monthlyPayment invalide');

  const matchPattern = typeof r.matchPattern === 'string' ? r.matchPattern.trim() : '';
  if (matchPattern) {
    try { new RegExp(matchPattern, 'i'); } catch {
      throw new BadRequestException(`matchPattern n'est pas un regex valide: ${matchPattern}`);
    }
  }

  const isActive = r.isActive !== false;

  const base: LoanInput = { name, type, category, monthlyPayment, matchPattern, isActive };

  if (type === 'classic') {
    const startDate = typeof r.startDate === 'string' ? r.startDate : '';
    if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new BadRequestException('startDate doit être YYYY-MM-DD');
    const endDate = typeof r.endDate === 'string' ? r.endDate : '';
    if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new BadRequestException('endDate doit être YYYY-MM-DD');
    const initialPrincipal = r.initialPrincipal != null ? Number(r.initialPrincipal) : undefined;
    if (initialPrincipal != null && !Number.isFinite(initialPrincipal)) throw new BadRequestException('initialPrincipal invalide');
    return { ...base, startDate: startDate || undefined, endDate: endDate || undefined, initialPrincipal };
  }

  // revolving
  const maxAmount = Number(r.maxAmount);
  if (!Number.isFinite(maxAmount) || maxAmount <= 0) throw new BadRequestException('maxAmount requis pour revolving');
  const usedAmount = r.usedAmount != null ? Number(r.usedAmount) : 0;
  if (!Number.isFinite(usedAmount) || usedAmount < 0) throw new BadRequestException('usedAmount invalide');
  if (usedAmount > maxAmount) throw new BadRequestException('usedAmount > maxAmount');
  return { ...base, maxAmount, usedAmount };
}
```

- [ ] **Step 2 : Commit**
```bash
git add backend/src/modules/loans/dto/loan.dto.ts
git commit -m "feat(loans): add input validation DTO with type discrimination"
```

### Task 3.3 : Test unit du service Loans

**Files:**
- Create: `backend/src/modules/loans/loans.service.spec.ts`

- [ ] **Step 1 : Écrire (failing)**

```ts
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LoansService } from './loans.service';
import { EventBusService } from '../events/event-bus.service';

describe('LoansService', () => {
  let svc: LoansService;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-loans-'));
    const mod = await Test.createTestingModule({
      providers: [
        LoansService,
        { provide: ConfigService, useValue: { get: (k: string) => k === 'dataDir' ? tmpDir : null } },
        { provide: EventBusService, useValue: { emit: jest.fn() } },
      ],
    }).compile();
    svc = mod.get(LoansService);
    await svc.onModuleInit();
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('starts empty', async () => {
    expect(await svc.getAll()).toEqual([]);
  });

  it('creates a classic loan', async () => {
    const loan = await svc.create({
      name: 'Crédit auto',
      type: 'classic',
      category: 'auto',
      monthlyPayment: 240,
      matchPattern: 'PRELEVT.*BANQUE',
      isActive: true,
      startDate: '2025-01-01',
      endDate: '2028-01-01',
    });
    expect(loan.id).toBeDefined();
    expect(loan.type).toBe('classic');
    expect(loan.occurrencesDetected).toEqual([]);
  });

  it('creates a revolving loan', async () => {
    const loan = await svc.create({
      name: 'Carte magasin',
      type: 'revolving',
      category: 'consumer',
      monthlyPayment: 80,
      matchPattern: 'COFIDIS',
      isActive: true,
      maxAmount: 3000,
      usedAmount: 1200,
    });
    expect(loan.maxAmount).toBe(3000);
    expect(loan.usedAmount).toBe(1200);
  });

  it('addOccurrence is idempotent on (statementId, transactionId)', async () => {
    const loan = await svc.create({
      name: 'Test',
      type: 'classic',
      category: 'consumer',
      monthlyPayment: 100,
      matchPattern: 'TEST',
      isActive: true,
    });
    await svc.addOccurrence(loan.id, { statementId: '2026-03', date: '2026-03-15', amount: -100, transactionId: 'tx-1' });
    await svc.addOccurrence(loan.id, { statementId: '2026-03', date: '2026-03-15', amount: -100, transactionId: 'tx-1' });
    const reloaded = await svc.getOne(loan.id);
    expect(reloaded.occurrencesDetected).toHaveLength(1);
  });

  it('addOccurrence on revolving decrements usedAmount', async () => {
    const loan = await svc.create({
      name: 'Carte',
      type: 'revolving',
      category: 'consumer',
      monthlyPayment: 80,
      matchPattern: 'C',
      isActive: true,
      maxAmount: 3000,
      usedAmount: 1200,
    });
    await svc.addOccurrence(loan.id, { statementId: '2026-03', date: '2026-03-15', amount: -80, transactionId: 'tx-1' });
    const reloaded = await svc.getOne(loan.id);
    expect(reloaded.usedAmount).toBe(1120);
  });

  it('resetRevolving updates usedAmount and lastManualResetAt', async () => {
    const loan = await svc.create({
      name: 'Carte',
      type: 'revolving',
      category: 'consumer',
      monthlyPayment: 80,
      matchPattern: 'C',
      isActive: true,
      maxAmount: 3000,
      usedAmount: 1200,
    });
    const updated = await svc.resetRevolving(loan.id, 800);
    expect(updated.usedAmount).toBe(800);
    expect(updated.lastManualResetAt).toBeDefined();
  });
});
```

- [ ] **Step 2 : Run et constater l'échec**
Run: `cd backend && npm test -- loans.service.spec`
Expected: FAIL — module LoansService introuvable.

### Task 3.4 : Implémenter LoansService

**Files:**
- Create: `backend/src/modules/loans/loans.service.ts`

- [ ] **Step 1 : Implémenter**

```ts
import { Injectable, Logger, NotFoundException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { Loan, LoanInput, LoanOccurrence } from '../../models/loan.model';
import { EventBusService } from '../events/event-bus.service';

@Injectable()
export class LoansService implements OnModuleInit {
  private readonly logger = new Logger(LoansService.name);
  private filepath!: string;

  constructor(
    private readonly config: ConfigService,
    private readonly bus: EventBusService,
  ) {}

  onModuleInit() {
    this.filepath = path.resolve(this.config.get<string>('dataDir')!, 'loans.json');
  }

  async getAll(): Promise<Loan[]> {
    try {
      const c = await fs.promises.readFile(this.filepath, 'utf8');
      return JSON.parse(c) as Loan[];
    } catch { return []; }
  }

  async getOne(id: string): Promise<Loan> {
    const l = (await this.getAll()).find((x) => x.id === id);
    if (!l) throw new NotFoundException(`Crédit ${id} introuvable`);
    return l;
  }

  async create(input: LoanInput): Promise<Loan> {
    const all = await this.getAll();
    const now = new Date().toISOString();
    const loan: Loan = { ...input, id: randomUUID(), occurrencesDetected: [], createdAt: now, updatedAt: now };
    all.push(loan);
    await this.persist(all);
    this.logger.log(`Created loan ${loan.id} (${loan.name})`);
    return loan;
  }

  async update(id: string, input: LoanInput): Promise<Loan> {
    const all = await this.getAll();
    const idx = all.findIndex((l) => l.id === id);
    if (idx === -1) throw new NotFoundException(`Crédit ${id} introuvable`);
    all[idx] = {
      ...all[idx],
      ...input,
      id: all[idx].id,
      occurrencesDetected: all[idx].occurrencesDetected,
      createdAt: all[idx].createdAt,
      updatedAt: new Date().toISOString(),
    };
    await this.persist(all);
    return all[idx];
  }

  async delete(id: string): Promise<void> {
    const all = await this.getAll();
    const next = all.filter((l) => l.id !== id);
    if (next.length === all.length) throw new NotFoundException(`Crédit ${id} introuvable`);
    await this.persist(next);
  }

  async addOccurrence(
    id: string,
    occ: { statementId: string; date: string; amount: number; transactionId: string | null },
  ): Promise<Loan> {
    const all = await this.getAll();
    const idx = all.findIndex((l) => l.id === id);
    if (idx === -1) throw new NotFoundException(`Crédit ${id} introuvable`);
    const loan = all[idx];
    const dupKey = (o: LoanOccurrence) => `${o.statementId}|${o.transactionId ?? ''}`;
    const newKey = `${occ.statementId}|${occ.transactionId ?? ''}`;
    if (loan.occurrencesDetected.some((o) => dupKey(o) === newKey)) {
      this.logger.debug(`Skipping duplicate occurrence on loan ${id}`);
      return loan;
    }
    const newOcc: LoanOccurrence = { id: randomUUID(), ...occ };
    loan.occurrencesDetected.push(newOcc);
    if (loan.type === 'revolving' && loan.usedAmount != null) {
      loan.usedAmount = Math.max(0, Math.round((loan.usedAmount - Math.abs(occ.amount)) * 100) / 100);
    }
    loan.updatedAt = new Date().toISOString();
    await this.persist(all);
    return loan;
  }

  async removeOccurrencesForStatement(statementId: string): Promise<void> {
    const all = await this.getAll();
    let dirty = false;
    for (const loan of all) {
      const before = loan.occurrencesDetected.length;
      loan.occurrencesDetected = loan.occurrencesDetected.filter((o) => o.statementId !== statementId);
      if (loan.occurrencesDetected.length !== before) {
        dirty = true;
        loan.updatedAt = new Date().toISOString();
      }
    }
    if (dirty) await this.persist(all);
  }

  async resetRevolving(id: string, newUsedAmount: number): Promise<Loan> {
    const all = await this.getAll();
    const idx = all.findIndex((l) => l.id === id);
    if (idx === -1) throw new NotFoundException(`Crédit ${id} introuvable`);
    if (all[idx].type !== 'revolving') throw new BadRequestException('Reset valide uniquement pour revolving');
    if (all[idx].maxAmount != null && newUsedAmount > all[idx].maxAmount) {
      throw new BadRequestException('usedAmount > maxAmount');
    }
    all[idx].usedAmount = newUsedAmount;
    all[idx].lastManualResetAt = new Date().toISOString();
    all[idx].updatedAt = new Date().toISOString();
    await this.persist(all);
    return all[idx];
  }

  private async persist(all: Loan[]): Promise<void> {
    await fs.promises.writeFile(this.filepath, JSON.stringify(all, null, 2), 'utf8');
    this.bus.emit('loans-changed');
  }
}
```

- [ ] **Step 2 : Run le test**
Run: `cd backend && npm test -- loans.service.spec`
Expected: PASS (6 tests).

- [ ] **Step 3 : Commit**
```bash
git add backend/src/modules/loans/loans.service{,.spec}.ts
git commit -m "feat(loans): implement CRUD + addOccurrence + resetRevolving"
```

### Task 3.5 : Controller + module loans

**Files:**
- Create: `backend/src/modules/loans/loans.controller.ts`
- Create: `backend/src/modules/loans/loans.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1 : Controller**

```ts
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { LoansService } from './loans.service';
import { validateLoanInput } from './dto/loan.dto';

@Controller('loans')
export class LoansController {
  constructor(private readonly svc: LoansService) {}

  @Get()
  list() { return this.svc.getAll(); }

  @Get(':id')
  one(@Param('id') id: string) { return this.svc.getOne(id); }

  @Post()
  create(@Body() body: unknown) { return this.svc.create(validateLoanInput(body)); }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.svc.update(id, validateLoanInput(body));
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id') id: string): Promise<void> { await this.svc.delete(id); }

  @Post(':id/reset-revolving')
  reset(@Param('id') id: string, @Body() body: { usedAmount: number }) {
    return this.svc.resetRevolving(id, Number(body.usedAmount));
  }
}
```

- [ ] **Step 2 : Module**

```ts
import { Module } from '@nestjs/common';
import { LoansController } from './loans.controller';
import { LoansService } from './loans.service';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [EventsModule],
  controllers: [LoansController],
  providers: [LoansService],
  exports: [LoansService],
})
export class LoansModule {}
```

- [ ] **Step 3 : Wire dans `app.module.ts`** — ajouter `LoansModule` aux imports.

- [ ] **Step 4 : Commit**
Run: `cd backend && npx tsc --noEmit -p tsconfig.json`

```bash
git add backend/src/modules/loans/{loans.controller.ts,loans.module.ts} backend/src/app.module.ts
git commit -m "feat(loans): wire controller + module"
```

### Task 3.6 : Frontend types + queries

**Files:**
- Modify: `frontend/src/types/api.ts`
- Modify: `frontend/src/lib/queries.ts`

- [ ] **Step 1 : Types**

Append à `frontend/src/types/api.ts` :

```ts
export type LoanType = 'classic' | 'revolving';
export type LoanCategory = 'mortgage' | 'consumer' | 'auto' | 'student' | 'other';

export const LOAN_CATEGORY_LABELS: Record<LoanCategory, string> = {
  mortgage: 'Immobilier',
  consumer: 'Conso',
  auto: 'Auto',
  student: 'Étudiant',
  other: 'Autre',
};

export interface LoanOccurrence {
  id: string;
  statementId: string;
  date: string;
  amount: number;
  transactionId: string | null;
}

export interface Loan {
  id: string;
  name: string;
  type: LoanType;
  category: LoanCategory;
  monthlyPayment: number;
  matchPattern: string;
  isActive: boolean;
  startDate?: string;
  endDate?: string;
  initialPrincipal?: number;
  maxAmount?: number;
  usedAmount?: number;
  lastManualResetAt?: string;
  occurrencesDetected: LoanOccurrence[];
  createdAt: string;
  updatedAt: string;
}

export type LoanInput = Omit<Loan, 'id' | 'occurrencesDetected' | 'createdAt' | 'updatedAt'>;
```

- [ ] **Step 2 : Hooks**

Append à `frontend/src/lib/queries.ts` (réutilise les imports déjà en place) :

```ts
import type { Loan, LoanInput } from '@/types/api';

export const qkLoans = {
  all: () => ['loans'] as const,
  one: (id: string) => ['loans', id] as const,
};

export function useLoans() {
  return useQuery({ queryKey: qkLoans.all(), queryFn: () => api.get<Loan[]>('/loans') });
}

export function useCreateLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoanInput) => api.post<Loan>('/loans', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qkLoans.all() }),
  });
}

export function useUpdateLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: LoanInput }) =>
      api.put<Loan>(`/loans/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qkLoans.all() }),
  });
}

export function useDeleteLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/loans/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qkLoans.all() }),
  });
}

export function useResetRevolving() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, usedAmount }: { id: string; usedAmount: number }) =>
      api.post<Loan>(`/loans/${id}/reset-revolving`, { usedAmount }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qkLoans.all() }),
  });
}
```

- [ ] **Step 3 : Build TS et commit**
Run: `cd frontend && npx tsc -b --noEmit`

```bash
git add frontend/src/{types/api.ts,lib/queries.ts}
git commit -m "feat(loans): add frontend types and hooks"
```

### Task 3.7 : Page `/loans` avec sections classique / revolving

**Files:**
- Create: `frontend/src/routes/loans.tsx`
- Modify: `frontend/src/router.tsx`
- Modify: `frontend/src/components/layout/sidebar.tsx`

- [ ] **Step 1 : Page**

```tsx
import { useState } from 'react';
import { Plus, CreditCard, Pencil, Trash2, X, Banknote } from 'lucide-react';
import { useLoans, useCreateLoan, useUpdateLoan, useDeleteLoan, useResetRevolving } from '@/lib/queries';
import { PageHeader } from '@/components/page-header';
import { LoadingState, EmptyState } from '@/components/loading-state';
import { type Loan, type LoanInput, type LoanType, type LoanCategory, LOAN_CATEGORY_LABELS } from '@/types/api';
import { formatEUR, cn } from '@/lib/utils';

const CATEGORIES: LoanCategory[] = ['mortgage', 'consumer', 'auto', 'student', 'other'];

const DEFAULT: LoanInput = {
  name: '',
  type: 'classic',
  category: 'consumer',
  monthlyPayment: 0,
  matchPattern: '',
  isActive: true,
  startDate: '',
  endDate: '',
};

export function LoansPage() {
  const { data, isLoading } = useLoans();
  const create = useCreateLoan();
  const update = useUpdateLoan();
  const remove = useDeleteLoan();
  const [editing, setEditing] = useState<Loan | null>(null);
  const [creating, setCreating] = useState(false);

  if (isLoading) return <LoadingState />;
  const items = data ?? [];
  const classics = items.filter((l) => l.type === 'classic' && l.isActive);
  const revolvings = items.filter((l) => l.type === 'revolving' && l.isActive);
  const totalMonthly = items.filter((l) => l.isActive).reduce((s, l) => s + l.monthlyPayment, 0);

  const handleSave = async (input: LoanInput) => {
    if (editing) await update.mutateAsync({ id: editing.id, input });
    else await create.mutateAsync(input);
    setEditing(null);
    setCreating(false);
  };

  return (
    <>
      <PageHeader
        eyebrow="Crédits"
        title={`${formatEUR(totalMonthly)} / mois`}
        subtitle={`${items.filter((l) => l.isActive).length} crédit${items.length > 1 ? 's' : ''} actif${items.length > 1 ? 's' : ''}`}
        actions={
          <button onClick={() => { setCreating(true); setEditing(null); }} className="btn-primary">
            <Plus className="h-4 w-4" /> Nouveau crédit
          </button>
        }
      />

      {items.length === 0 ? (
        <EmptyState title="Aucun crédit déclaré" hint="Ajoute ton crédit immobilier, conso ou ta carte revolving." />
      ) : (
        <div className="space-y-8">
          {classics.length > 0 && (
            <section>
              <h2 className="font-display text-sm uppercase tracking-wider text-fg-dim mb-3">
                Crédits classiques ({classics.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {classics.map((l) => (
                  <ClassicCard key={l.id} loan={l} onEdit={() => setEditing(l)} onDelete={() => confirm(`Supprimer ${l.name} ?`) && remove.mutate(l.id)} />
                ))}
              </div>
            </section>
          )}

          {revolvings.length > 0 && (
            <section>
              <h2 className="font-display text-sm uppercase tracking-wider text-fg-dim mb-3">
                Crédits revolving ({revolvings.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {revolvings.map((l) => (
                  <RevolvingCard key={l.id} loan={l} onEdit={() => setEditing(l)} onDelete={() => confirm(`Supprimer ${l.name} ?`) && remove.mutate(l.id)} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {(creating || editing) && (
        <LoanForm
          init={editing ? toInput(editing) : DEFAULT}
          onSave={handleSave}
          onCancel={() => { setCreating(false); setEditing(null); }}
          busy={create.isPending || update.isPending}
        />
      )}
    </>
  );
}

function toInput(l: Loan): LoanInput {
  const { id: _i, occurrencesDetected: _o, createdAt: _c, updatedAt: _u, ...rest } = l;
  void _i; void _o; void _c; void _u;
  return rest;
}

function ClassicCard({ loan, onEdit, onDelete }: { loan: Loan; onEdit: () => void; onDelete: () => void }) {
  const start = loan.startDate ? new Date(loan.startDate).getTime() : 0;
  const end = loan.endDate ? new Date(loan.endDate).getTime() : 0;
  const now = Date.now();
  const total = end - start;
  const elapsed = Math.max(0, Math.min(total, now - start));
  const pct = total > 0 ? Math.round((elapsed / total) * 100) : 0;
  const monthsRemaining = end > now ? Math.ceil((end - now) / (1000 * 60 * 60 * 24 * 30.44)) : 0;
  const occurrences = loan.occurrencesDetected.length;

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Banknote className="h-4 w-4 text-accent" />
          <div>
            <div className="font-display font-semibold text-fg-bright">{loan.name}</div>
            <div className="text-xs text-fg-dim">{LOAN_CATEGORY_LABELS[loan.category]} · {formatEUR(loan.monthlyPayment)}/mois</div>
          </div>
        </div>
        <div className="flex gap-1">
          <button onClick={onEdit} className="btn-ghost p-1.5"><Pencil className="h-3.5 w-3.5" /></button>
          <button onClick={onDelete} className="btn-ghost p-1.5 hover:text-negative"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      {loan.startDate && loan.endDate ? (
        <>
          <div className="h-2 bg-surface-3 rounded-full overflow-hidden mb-2">
            <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-fg-dim">{pct}% écoulé</span>
            <span className="text-fg-bright tabular">{monthsRemaining} mois restants</span>
          </div>
          <div className="mt-2 text-xs text-fg-muted tabular">
            {occurrences} mensualité{occurrences > 1 ? 's' : ''} prélevée{occurrences > 1 ? 's' : ''}
          </div>
        </>
      ) : (
        <p className="text-xs text-fg-dim italic">Renseigne les dates de début et fin pour activer le suivi.</p>
      )}
    </div>
  );
}

function RevolvingCard({ loan, onEdit, onDelete }: { loan: Loan; onEdit: () => void; onDelete: () => void }) {
  const reset = useResetRevolving();
  const max = loan.maxAmount ?? 0;
  const used = loan.usedAmount ?? 0;
  const pct = max > 0 ? Math.round((used / max) * 100) : 0;
  const tone = pct >= 80 ? 'bg-negative' : pct >= 50 ? 'bg-warning' : 'bg-positive';

  const handleReset = async () => {
    const v = prompt(`Solde utilisé actuel pour ${loan.name} (max ${formatEUR(max)}) :`, String(used));
    if (v == null) return;
    const n = Number(v);
    if (!Number.isFinite(n)) return alert('Valeur invalide');
    await reset.mutateAsync({ id: loan.id, usedAmount: n });
  };

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-warning" />
          <div>
            <div className="font-display font-semibold text-fg-bright">{loan.name}</div>
            <div className="text-xs text-fg-dim">Revolving · {formatEUR(loan.monthlyPayment)}/mois</div>
          </div>
        </div>
        <div className="flex gap-1">
          <button onClick={onEdit} className="btn-ghost p-1.5"><Pencil className="h-3.5 w-3.5" /></button>
          <button onClick={onDelete} className="btn-ghost p-1.5 hover:text-negative"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <div className="h-3 bg-surface-3 rounded-full overflow-hidden mb-2">
        <div className={cn('h-full transition-all', tone)} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center justify-between text-xs tabular">
        <span className="text-fg-bright">{formatEUR(used)} utilisés</span>
        <span className="text-fg-dim">/ {formatEUR(max)} ({pct}%)</span>
      </div>
      <div className="text-xs text-fg-muted tabular mt-1">{formatEUR(max - used)} disponibles</div>
      <button onClick={handleReset} className="btn-ghost text-xs mt-3">Recaler le solde</button>
    </div>
  );
}

function LoanForm({ init, onSave, onCancel, busy }: { init: LoanInput; onSave: (i: LoanInput) => void; onCancel: () => void; busy: boolean }) {
  const [form, setForm] = useState<LoanInput>(init);
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" onClick={onCancel}>
      <div className="card max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-display font-semibold text-fg-bright">{init.name ? 'Modifier le crédit' : 'Nouveau crédit'}</h2>
          <button onClick={onCancel} className="btn-ghost p-1"><X className="h-4 w-4" /></button>
        </div>
        <form className="p-5 space-y-3" onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
          <Field label="Nom"><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as LoanType })}>
                <option value="classic">Classique</option>
                <option value="revolving">Revolving</option>
              </select>
            </Field>
            <Field label="Catégorie">
              <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as LoanCategory })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{LOAN_CATEGORY_LABELS[c]}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mensualité (€)">
              <input className="input tabular" type="number" step="0.01" required value={form.monthlyPayment}
                     onChange={(e) => setForm({ ...form, monthlyPayment: Number(e.target.value) })} />
            </Field>
            <Field label="Pattern (regex)">
              <input className="input font-mono text-xs" placeholder="PRELEVT.*BANQUE" value={form.matchPattern}
                     onChange={(e) => setForm({ ...form, matchPattern: e.target.value })} />
            </Field>
          </div>
          {form.type === 'classic' ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date début">
                <input className="input" type="date" value={form.startDate ?? ''} onChange={(e) => setForm({ ...form, startDate: e.target.value || undefined })} />
              </Field>
              <Field label="Date fin">
                <input className="input" type="date" value={form.endDate ?? ''} onChange={(e) => setForm({ ...form, endDate: e.target.value || undefined })} />
              </Field>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Plafond (€)">
                <input className="input tabular" type="number" step="0.01" required value={form.maxAmount ?? 0}
                       onChange={(e) => setForm({ ...form, maxAmount: Number(e.target.value) })} />
              </Field>
              <Field label="Utilisé (€)">
                <input className="input tabular" type="number" step="0.01" value={form.usedAmount ?? 0}
                       onChange={(e) => setForm({ ...form, usedAmount: Number(e.target.value) })} />
              </Field>
            </div>
          )}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onCancel} className="btn-secondary">Annuler</button>
            <button type="submit" disabled={busy} className="btn-primary">Enregistrer</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="stat-label block mb-1.5">{label}</span>{children}</label>;
}
```

- [ ] **Step 2 : Router + sidebar**

Dans `router.tsx`, ajouter import `import { LoansPage } from './routes/loans';` puis créer `loansRoute` avec path `/loans` et l'ajouter à `routeTree`.

Dans `sidebar.tsx`, importer `Banknote` et ajouter `{ to: '/loans', label: 'Crédits', icon: Banknote, exact: false }` après l'item `/savings`.

- [ ] **Step 3 : Build TS et commit**
Run: `cd frontend && npx tsc -b --noEmit`

```bash
git add frontend/src/{routes/loans.tsx,router.tsx,components/layout/sidebar.tsx}
git commit -m "feat(loans): add /loans page with classic/revolving sections"
```

### Task 3.8 : Test e2e Phase 3
- Sync NAS, build, ouvrir `/loans`, créer 1 classique + 1 revolving, vérifier les barres.
```bash
git tag v3-phase3-done
```

---

## Phase 4 — AutoSyncService (post-import)

**Pré-requis :** Phases 2 et 3.

**Goal :** à chaque persistance d'un MonthlyStatement, scanner les transactions pour mettre à jour automatiquement les balances des `SavingsAccount` et les occurrences des `Loan`. Idempotent. Calcul intérêts annuels au mois anniversaire.

### File Structure

| Path | Responsabilité |
|------|----------------|
| `backend/src/modules/auto-sync/auto-sync.service.ts` | Logique de sync |
| `backend/src/modules/auto-sync/auto-sync.module.ts` | Wiring |
| `backend/src/modules/auto-sync/auto-sync.service.spec.ts` | Tests unit |
| `backend/src/modules/analysis/analysis.service.ts` | Hook après save |
| `backend/src/modules/statements/statements.controller.ts` | Hook avant delete |

### Task 4.1 : Test de l'AutoSyncService

**Files:**
- Create: `backend/src/modules/auto-sync/auto-sync.service.spec.ts`

- [ ] **Step 1 : Écrire le test avec mocks**

```ts
import { Test } from '@nestjs/testing';
import { AutoSyncService } from './auto-sync.service';
import { SavingsService } from '../savings/savings.service';
import { LoansService } from '../loans/loans.service';
import { EventBusService } from '../events/event-bus.service';
import { MonthlyStatement } from '../../models/monthly-statement.model';

const baseStatement: MonthlyStatement = {
  id: '2026-03',
  month: 3,
  year: 2026,
  uploadedAt: '2026-04-01T00:00:00Z',
  bankName: 'LBP',
  accountHolder: 'Sylvain',
  currency: 'EUR',
  openingBalance: 1000,
  closingBalance: 900,
  totalCredits: 2500,
  totalDebits: 2600,
  transactions: [],
  healthScore: { total: 70, breakdown: { savingsRate: 50, expenseControl: 60, debtBurden: 70, cashFlowBalance: 50, irregularSpending: 80 }, trend: 'insufficient_data', claudeComment: '' },
  recurringCredits: [],
  analysisNarrative: '',
};

describe('AutoSyncService', () => {
  let svc: AutoSyncService;
  let savings: jest.Mocked<SavingsService>;
  let loans: jest.Mocked<LoansService>;

  beforeEach(async () => {
    savings = {
      getAll: jest.fn(),
      addMovement: jest.fn(),
      removeMovementsForStatement: jest.fn(),
    } as unknown as jest.Mocked<SavingsService>;
    loans = {
      getAll: jest.fn(),
      addOccurrence: jest.fn(),
      removeOccurrencesForStatement: jest.fn(),
    } as unknown as jest.Mocked<LoansService>;
    const mod = await Test.createTestingModule({
      providers: [
        AutoSyncService,
        { provide: SavingsService, useValue: savings },
        { provide: LoansService, useValue: loans },
        { provide: EventBusService, useValue: { emit: jest.fn() } },
      ],
    }).compile();
    svc = mod.get(AutoSyncService);
  });

  it('matches savings transactions by regex and adds movements', async () => {
    savings.getAll.mockResolvedValue([{
      id: 'pel-1', name: 'PEL', type: 'pel', initialBalance: 1000, initialBalanceDate: '2026-01-01',
      matchPattern: 'VIR.*PEL', interestRate: 0.02, interestAnniversaryMonth: 6,
      currentBalance: 1000, lastSyncedStatementId: null, movements: [], createdAt: '', updatedAt: '',
    }]);
    loans.getAll.mockResolvedValue([]);
    const stmt: MonthlyStatement = {
      ...baseStatement,
      transactions: [
        { id: 'tx1', date: '2026-03-05', description: 'VIR EPARGNE PEL', normalizedDescription: 'vir epargne pel', amount: -100, currency: 'EUR', category: 'savings', subcategory: '', isRecurring: true, confidence: 1 },
        { id: 'tx2', date: '2026-03-12', description: 'COURSES CARREFOUR', normalizedDescription: 'courses carrefour', amount: -42, currency: 'EUR', category: 'food', subcategory: '', isRecurring: false, confidence: 1 },
      ],
    };
    await svc.syncStatement(stmt);
    expect(savings.addMovement).toHaveBeenCalledTimes(1);
    expect(savings.addMovement).toHaveBeenCalledWith('pel-1', expect.objectContaining({
      amount: 100, source: 'detected', statementId: '2026-03', transactionId: 'tx1',
    }));
  });

  it('matches loan transactions by regex and adds occurrences', async () => {
    savings.getAll.mockResolvedValue([]);
    loans.getAll.mockResolvedValue([{
      id: 'loan-1', name: 'Cofidis', type: 'revolving', category: 'consumer',
      monthlyPayment: 80, matchPattern: 'COFIDIS', isActive: true, maxAmount: 3000, usedAmount: 1200,
      occurrencesDetected: [], createdAt: '', updatedAt: '',
    }]);
    const stmt: MonthlyStatement = {
      ...baseStatement,
      transactions: [
        { id: 'tx1', date: '2026-03-10', description: 'PRELEVT COFIDIS', normalizedDescription: 'prelevt cofidis', amount: -80, currency: 'EUR', category: 'subscriptions', subcategory: '', isRecurring: true, confidence: 1 },
      ],
    };
    await svc.syncStatement(stmt);
    expect(loans.addOccurrence).toHaveBeenCalledWith('loan-1', expect.objectContaining({
      statementId: '2026-03', amount: -80, transactionId: 'tx1',
    }));
  });

  it('skips entities with empty matchPattern', async () => {
    savings.getAll.mockResolvedValue([{
      id: 'a', name: 'A', type: 'other', initialBalance: 0, initialBalanceDate: '2026-01-01',
      matchPattern: '', interestRate: 0, interestAnniversaryMonth: 1,
      currentBalance: 0, lastSyncedStatementId: null, movements: [], createdAt: '', updatedAt: '',
    }]);
    loans.getAll.mockResolvedValue([]);
    await svc.syncStatement({ ...baseStatement, transactions: [] });
    expect(savings.addMovement).not.toHaveBeenCalled();
  });

  it('catches invalid regex without throwing', async () => {
    savings.getAll.mockResolvedValue([{
      id: 'a', name: 'A', type: 'other', initialBalance: 0, initialBalanceDate: '2026-01-01',
      matchPattern: '[invalid(', interestRate: 0, interestAnniversaryMonth: 1,
      currentBalance: 0, lastSyncedStatementId: null, movements: [], createdAt: '', updatedAt: '',
    }]);
    loans.getAll.mockResolvedValue([]);
    await expect(svc.syncStatement({ ...baseStatement, transactions: [{ id: 't', date: '2026-03-01', description: 'X', normalizedDescription: 'x', amount: -1, currency: 'EUR', category: 'other', subcategory: '', isRecurring: false, confidence: 0 }] })).resolves.not.toThrow();
    expect(savings.addMovement).not.toHaveBeenCalled();
  });

  it('removeForStatement is called for both services', async () => {
    await svc.removeForStatement('2026-03');
    expect(savings.removeMovementsForStatement).toHaveBeenCalledWith('2026-03');
    expect(loans.removeOccurrencesForStatement).toHaveBeenCalledWith('2026-03');
  });
});
```

- [ ] **Step 2 : Run le test (FAIL)**
Run: `cd backend && npm test -- auto-sync.service.spec`
Expected: FAIL — module introuvable.

### Task 4.2 : Implémenter AutoSyncService

**Files:**
- Create: `backend/src/modules/auto-sync/auto-sync.service.ts`

- [ ] **Step 1 : Écrire**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { SavingsService } from '../savings/savings.service';
import { LoansService } from '../loans/loans.service';
import { EventBusService } from '../events/event-bus.service';
import { MonthlyStatement } from '../../models/monthly-statement.model';
import { Transaction } from '../../models/transaction.model';
import { SavingsAccount } from '../../models/savings-account.model';

@Injectable()
export class AutoSyncService {
  private readonly logger = new Logger(AutoSyncService.name);

  constructor(
    private readonly savings: SavingsService,
    private readonly loans: LoansService,
    private readonly bus: EventBusService,
  ) {}

  async syncStatement(statement: MonthlyStatement): Promise<void> {
    await this.syncSavings(statement);
    await this.syncLoans(statement);
    this.bus.emit('accounts-synced');
  }

  async removeForStatement(statementId: string): Promise<void> {
    await this.savings.removeMovementsForStatement(statementId);
    await this.loans.removeOccurrencesForStatement(statementId);
    this.bus.emit('accounts-synced');
  }

  private async syncSavings(statement: MonthlyStatement): Promise<void> {
    const accounts = await this.savings.getAll();
    for (const acc of accounts) {
      if (!acc.matchPattern) continue;
      let regex: RegExp;
      try {
        regex = new RegExp(acc.matchPattern, 'i');
      } catch (e) {
        this.logger.warn(`Invalid regex on savings ${acc.id}: ${acc.matchPattern}`);
        continue;
      }
      const matches = statement.transactions.filter((t) => regex.test(t.description));
      for (const t of matches) {
        // Signe : un débit côté courant (= sortie LBP, amount<0) est un dépôt sur le compte épargne (+).
        // Convention : on inverse le signe.
        const epargneAmount = -t.amount;
        await this.safeAddMovement(acc, t, epargneAmount, statement.id);
      }
      await this.maybeAddInterest(acc, statement);
    }
  }

  private async safeAddMovement(acc: SavingsAccount, t: Transaction, amount: number, statementId: string): Promise<void> {
    const dup = acc.movements.some((m) => m.statementId === statementId && m.transactionId === t.id);
    if (dup) return;
    await this.savings.addMovement(acc.id, {
      date: t.date,
      amount,
      source: 'detected',
      statementId,
      transactionId: t.id,
      note: `Auto: ${t.description}`,
    });
  }

  private async maybeAddInterest(acc: SavingsAccount, statement: MonthlyStatement): Promise<void> {
    if (statement.month !== acc.interestAnniversaryMonth) return;
    const alreadyDone = acc.movements.some((m) => m.source === 'interest' && m.date.startsWith(`${statement.year}-`));
    if (alreadyDone) return;
    // Estimation simple : balance courante × taux annuel.
    // Méthode quinzaine Livret A volontairement omise (out of scope V3).
    const interest = Math.round(acc.currentBalance * acc.interestRate * 100) / 100;
    if (interest <= 0) return;
    await this.savings.addMovement(acc.id, {
      date: `${statement.year}-${String(statement.month).padStart(2, '0')}-31`,
      amount: interest,
      source: 'interest',
      statementId: statement.id,
      transactionId: null,
      note: `Intérêts ${statement.year} (${(acc.interestRate * 100).toFixed(2)}%)`,
    });
  }

  private async syncLoans(statement: MonthlyStatement): Promise<void> {
    const loans = await this.loans.getAll();
    for (const loan of loans) {
      if (!loan.isActive || !loan.matchPattern) continue;
      let regex: RegExp;
      try {
        regex = new RegExp(loan.matchPattern, 'i');
      } catch {
        this.logger.warn(`Invalid regex on loan ${loan.id}: ${loan.matchPattern}`);
        continue;
      }
      const matches = statement.transactions.filter((t) => regex.test(t.description));
      for (const t of matches) {
        await this.loans.addOccurrence(loan.id, {
          statementId: statement.id,
          date: t.date,
          amount: t.amount,
          transactionId: t.id,
        });
      }
    }
  }
}
```

- [ ] **Step 2 : Ajouter `removeMovementsForStatement` à `SavingsService`**

Dans `backend/src/modules/savings/savings.service.ts`, ajouter avant `private async persist` :

```ts
  async removeMovementsForStatement(statementId: string): Promise<void> {
    const all = await this.getAll();
    let dirty = false;
    for (const acc of all) {
      const before = acc.movements.length;
      const removed = acc.movements.filter((m) => m.statementId === statementId);
      if (removed.length === 0) continue;
      acc.movements = acc.movements.filter((m) => m.statementId !== statementId);
      const delta = removed.reduce((s, m) => s + m.amount, 0);
      acc.currentBalance = Math.round((acc.currentBalance - delta) * 100) / 100;
      acc.updatedAt = new Date().toISOString();
      dirty = true;
      this.logger.log(`Removed ${removed.length} movements for statement ${statementId} on ${acc.id}`);
      void before;
    }
    if (dirty) await this.persist(all);
  }
```

- [ ] **Step 3 : Run le test**
Run: `cd backend && npm test -- auto-sync.service.spec`
Expected: PASS (5 tests).

- [ ] **Step 4 : Module + commit**

Créer `backend/src/modules/auto-sync/auto-sync.module.ts` :

```ts
import { Module } from '@nestjs/common';
import { AutoSyncService } from './auto-sync.service';
import { SavingsModule } from '../savings/savings.module';
import { LoansModule } from '../loans/loans.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [SavingsModule, LoansModule, EventsModule],
  providers: [AutoSyncService],
  exports: [AutoSyncService],
})
export class AutoSyncModule {}
```

Ajouter `AutoSyncModule` à l'array `imports` de `app.module.ts`.

```bash
git add backend/src/modules/{auto-sync,savings/savings.service.ts}
git commit -m "feat(auto-sync): implement AutoSyncService with idempotency and FR-friendly interests"
```

### Task 4.3 : Brancher AutoSync dans AnalysisService et StatementsController

**Files:**
- Modify: `backend/src/modules/analysis/analysis.service.ts`
- Modify: `backend/src/modules/analysis/analysis.module.ts`
- Modify: `backend/src/modules/statements/statements.controller.ts`
- Modify: `backend/src/modules/statements/statements.module.ts`

- [ ] **Step 1 : Injecter AutoSyncService dans AnalysisService**

Dans `analysis.service.ts`, ajouter dans le constructor :

```ts
import { AutoSyncService } from '../auto-sync/auto-sync.service';
// ...
  constructor(
    private readonly anthropic: AnthropicService,
    private readonly storage: StorageService,
    private readonly snapshots: SnapshotService,
    private readonly autoSync: AutoSyncService,
  ) {}
```

Et après le `await this.storage.saveStatement(statement);` :

```ts
    try {
      await this.autoSync.syncStatement(statement);
    } catch (e) {
      this.logger.error(`AutoSync failed for ${statement.id}`, e as Error);
      // Ne pas bloquer la persistance — on logge et on poursuit.
    }
```

- [ ] **Step 2 : Importer AutoSyncModule dans AnalysisModule**

Dans `analysis.module.ts` :

```ts
import { AutoSyncModule } from '../auto-sync/auto-sync.module';
// ...
@Module({
  imports: [/* existing */, AutoSyncModule],
  // ...
})
```

- [ ] **Step 3 : Brancher la suppression dans StatementsController**

Dans `statements.controller.ts`, importer et injecter `AutoSyncService` :

```ts
import { AutoSyncService } from '../auto-sync/auto-sync.service';
// ...
  constructor(
    private readonly storage: StorageService,
    private readonly snapshots: SnapshotService,
    private readonly analysis: AnalysisService,
    private readonly autoSync: AutoSyncService,
  ) {}
```

Modifier la méthode `remove` :

```ts
  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.snapshots.takeSnapshot(`before-delete-${id}`);
    await this.autoSync.removeForStatement(id);
    const deleted = await this.storage.deleteStatement(id);
    if (!deleted) throw new NotFoundException(`Relevé ${id} introuvable`);
    return { message: `Relevé ${id} supprimé` };
  }
```

Ajouter `AutoSyncModule` aux imports de `statements.module.ts`.

- [ ] **Step 4 : Build TS + commit**

Run: `cd backend && npx tsc --noEmit -p tsconfig.json`

```bash
git add backend/src/modules/{analysis,statements}
git commit -m "feat(auto-sync): wire post-import sync and pre-delete cleanup"
```

### Task 4.4 : Endpoint manuel `POST /api/savings-accounts/:id/resync`

Pour permettre à l'utilisateur de re-scanner tous les statements existants après avoir créé un compte (backfill).

**Files:**
- Modify: `backend/src/modules/savings/savings.controller.ts`
- Modify: `backend/src/modules/savings/savings.module.ts`
- Modify: `backend/src/modules/savings/savings.service.ts` (méthode `resync`)
- Modify: `backend/src/modules/loans/loans.controller.ts` (idem)

- [ ] **Step 1 : Méthode `resyncAccount` dans SavingsService**

```ts
  async clearDetectedMovements(id: string): Promise<void> {
    const all = await this.getAll();
    const idx = all.findIndex((a) => a.id === id);
    if (idx === -1) throw new NotFoundException(`Compte ${id} introuvable`);
    const acc = all[idx];
    const detected = acc.movements.filter((m) => m.source === 'detected' || m.source === 'interest');
    if (detected.length === 0) return;
    const delta = detected.reduce((s, m) => s + m.amount, 0);
    acc.movements = acc.movements.filter((m) => m.source !== 'detected' && m.source !== 'interest');
    acc.currentBalance = Math.round((acc.currentBalance - delta) * 100) / 100;
    acc.updatedAt = new Date().toISOString();
    await this.persist(all);
  }
```

- [ ] **Step 2 : Service de resync dédié**

Créer `backend/src/modules/auto-sync/resync.service.ts` :

```ts
import { Injectable } from '@nestjs/common';
import { AutoSyncService } from './auto-sync.service';
import { StorageService } from '../storage/storage.service';
import { SavingsService } from '../savings/savings.service';

@Injectable()
export class ResyncService {
  constructor(
    private readonly autoSync: AutoSyncService,
    private readonly storage: StorageService,
    private readonly savings: SavingsService,
  ) {}

  async resyncSavingsAccount(id: string): Promise<void> {
    await this.savings.clearDetectedMovements(id);
    const statements = await this.storage.getAllStatements();
    for (const s of statements) {
      await this.autoSync.syncStatement(s);
    }
  }
}
```

Ajouter au `auto-sync.module.ts` les providers/exports `ResyncService` (et `imports: [..., StorageModule]`).

- [ ] **Step 3 : Endpoint controller**

Dans `savings.controller.ts`, injecter `ResyncService` et ajouter :

```ts
  @Post(':id/resync')
  async resync(@Param('id') id: string) {
    await this.resync.resyncSavingsAccount(id);
    return { message: 'Resynced' };
  }
```

(Importer le module dans `savings.module.ts` via une circular-friendly approche : créer `auto-sync.module` avec `forwardRef`, ou plus simple — déplacer `ResyncService` dans `savings.module.ts` directement. Choix : injecter via constructor en important `AutoSyncModule` dans `SavingsModule` après. Si circulaire détectée à runtime, utiliser `forwardRef(() => AutoSyncModule)`.)

- [ ] **Step 4 : Hook côté front**

Dans `frontend/src/lib/queries.ts`, ajouter :

```ts
export function useResyncSavings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<void>(`/savings-accounts/${id}/resync`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qkSavings.all() }),
  });
}
```

Ajouter un bouton "Re-scanner tous les relevés" dans `SavingsCard` ou dans le menu d'édition.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/modules frontend/src/lib/queries.ts
git commit -m "feat(auto-sync): add resync endpoint for backfill on existing statements"
```

### Task 4.5 : Test e2e Phase 4

- Créer un Livret A avec pattern `VIR.*LIVRET`, importer un relevé contenant `VIR LIVRET A 50€`. Vérifier que le solde augmente.
- Supprimer le relevé. Vérifier que le mouvement détecté disparaît et que la balance revient à l'ancien.
```bash
git tag v3-phase4-done
```

---

## Phase 5 — Détection Claude des charges récurrentes (Suggestions)

**Pré-requis :** Phase 3, Phase 4 (AutoSyncService est étendu pour persister les suggestions).

### File Structure

| Path | Responsabilité |
|------|----------------|
| `backend/src/models/loan-suggestion.model.ts` | Type LoanSuggestion |
| `backend/src/modules/loan-suggestions/loan-suggestions.service.ts` | CRUD + dédup + transitions status |
| `backend/src/modules/loan-suggestions/loan-suggestions.controller.ts` | Endpoints REST |
| `backend/src/modules/loan-suggestions/loan-suggestions.module.ts` | Wiring |
| `backend/src/modules/loan-suggestions/loan-suggestions.service.spec.ts` | Tests unit |
| `backend/src/modules/analysis/anthropic.service.ts` | Ajouter champ `suggestedRecurringExpenses` au tool |
| `backend/src/modules/auto-sync/auto-sync.service.ts` | Upsert suggestions reçues |
| `frontend/src/types/api.ts` | Types front |
| `frontend/src/lib/queries.ts` | Hooks |
| `frontend/src/routes/loans.tsx` | Encart "Suggestions" en haut |

### Task 5.1 : Modèle + DTO

**Files:**
- Create: `backend/src/models/loan-suggestion.model.ts`

- [ ] **Step 1 : Écrire**

```ts
export type LoanSuggestionStatus = 'pending' | 'accepted' | 'rejected' | 'snoozed';
export type SuggestedExpenseType = 'loan' | 'subscription' | 'utility';

export interface LoanSuggestion {
  id: string;
  label: string;
  monthlyAmount: number;
  occurrencesSeen: number;
  firstSeenStatementId: string;
  firstSeenDate: string;
  lastSeenDate: string;
  suggestedType: SuggestedExpenseType;
  matchPattern: string;
  status: LoanSuggestionStatus;
  createdAt: string;
  resolvedAt?: string;
  acceptedAsLoanId?: string;
}

export interface IncomingSuggestion {
  label: string;
  monthlyAmount: number;
  occurrencesSeen: number;
  firstSeenDate: string;
  suggestedType: SuggestedExpenseType;
  matchPattern: string;
}
```

- [ ] **Step 2 : Commit**
```bash
git add backend/src/models/loan-suggestion.model.ts
git commit -m "feat(suggestions): add LoanSuggestion model"
```

### Task 5.2 : Test du service LoanSuggestionsService

**Files:**
- Create: `backend/src/modules/loan-suggestions/loan-suggestions.service.spec.ts`

- [ ] **Step 1 : Test (failing)**

```ts
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LoanSuggestionsService } from './loan-suggestions.service';
import { EventBusService } from '../events/event-bus.service';

describe('LoanSuggestionsService', () => {
  let svc: LoanSuggestionsService;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-sugg-'));
    const mod = await Test.createTestingModule({
      providers: [
        LoanSuggestionsService,
        { provide: ConfigService, useValue: { get: () => tmpDir } },
        { provide: EventBusService, useValue: { emit: jest.fn() } },
      ],
    }).compile();
    svc = mod.get(LoanSuggestionsService);
    await svc.onModuleInit();
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('upserts a new pending suggestion', async () => {
    await svc.upsertMany('2026-03', [{
      label: 'PRELEVT CETELEM',
      monthlyAmount: 320,
      occurrencesSeen: 5,
      firstSeenDate: '2025-11-15',
      suggestedType: 'loan',
      matchPattern: 'PRELEVT.*CETELEM',
    }]);
    const all = await svc.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe('pending');
    expect(all[0].occurrencesSeen).toBe(5);
  });

  it('deduplicates by matchPattern (incrementing occurrencesSeen)', async () => {
    const incoming = {
      label: 'PRELEVT CETELEM',
      monthlyAmount: 320,
      occurrencesSeen: 5,
      firstSeenDate: '2025-11-15',
      suggestedType: 'loan' as const,
      matchPattern: 'PRELEVT.*CETELEM',
    };
    await svc.upsertMany('2026-03', [incoming]);
    await svc.upsertMany('2026-04', [{ ...incoming, occurrencesSeen: 6, firstSeenDate: '2026-04-01' }]);
    const all = await svc.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].occurrencesSeen).toBe(6); // most recent count wins
    expect(all[0].lastSeenDate).toBe('2026-04-01');
  });

  it('does not resurrect rejected suggestions', async () => {
    const incoming = {
      label: 'X', monthlyAmount: 10, occurrencesSeen: 3, firstSeenDate: '2025-11-01',
      suggestedType: 'loan' as const, matchPattern: 'X',
    };
    await svc.upsertMany('2026-03', [incoming]);
    const [s] = await svc.getAll();
    await svc.reject(s.id);
    await svc.upsertMany('2026-04', [incoming]);
    const all = await svc.getAll();
    expect(all.find((x) => x.id === s.id)?.status).toBe('rejected');
  });

  it('accept marks resolvedAt and stores acceptedAsLoanId', async () => {
    await svc.upsertMany('2026-03', [{
      label: 'Y', monthlyAmount: 50, occurrencesSeen: 4, firstSeenDate: '2025-11-01',
      suggestedType: 'loan', matchPattern: 'Y',
    }]);
    const [s] = await svc.getAll();
    const updated = await svc.accept(s.id, 'loan-123');
    expect(updated.status).toBe('accepted');
    expect(updated.acceptedAsLoanId).toBe('loan-123');
    expect(updated.resolvedAt).toBeDefined();
  });
});
```

- [ ] **Step 2 : Run et constater FAIL**

### Task 5.3 : Implémenter LoanSuggestionsService

**Files:**
- Create: `backend/src/modules/loan-suggestions/loan-suggestions.service.ts`

- [ ] **Step 1 : Écrire**

```ts
import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { IncomingSuggestion, LoanSuggestion } from '../../models/loan-suggestion.model';
import { EventBusService } from '../events/event-bus.service';

@Injectable()
export class LoanSuggestionsService implements OnModuleInit {
  private readonly logger = new Logger(LoanSuggestionsService.name);
  private filepath!: string;

  constructor(private readonly config: ConfigService, private readonly bus: EventBusService) {}

  onModuleInit() {
    this.filepath = path.resolve(this.config.get<string>('dataDir')!, 'loan-suggestions.json');
  }

  async getAll(): Promise<LoanSuggestion[]> {
    try {
      return JSON.parse(await fs.promises.readFile(this.filepath, 'utf8')) as LoanSuggestion[];
    } catch { return []; }
  }

  async getPending(): Promise<LoanSuggestion[]> {
    return (await this.getAll()).filter((s) => s.status === 'pending' || s.status === 'snoozed');
  }

  async upsertMany(statementId: string, incoming: IncomingSuggestion[]): Promise<void> {
    if (incoming.length === 0) return;
    const all = await this.getAll();
    const now = new Date().toISOString();
    let dirty = false;
    for (const inc of incoming) {
      const existing = all.find((s) => this.normalizePattern(s.matchPattern) === this.normalizePattern(inc.matchPattern));
      if (existing) {
        if (existing.status === 'rejected') continue; // don't resurrect
        existing.occurrencesSeen = inc.occurrencesSeen;
        existing.lastSeenDate = inc.firstSeenDate;
        existing.monthlyAmount = inc.monthlyAmount;
        existing.label = inc.label;
        dirty = true;
      } else {
        all.push({
          id: randomUUID(),
          label: inc.label,
          monthlyAmount: inc.monthlyAmount,
          occurrencesSeen: inc.occurrencesSeen,
          firstSeenStatementId: statementId,
          firstSeenDate: inc.firstSeenDate,
          lastSeenDate: inc.firstSeenDate,
          suggestedType: inc.suggestedType,
          matchPattern: inc.matchPattern,
          status: 'pending',
          createdAt: now,
        });
        dirty = true;
      }
    }
    if (dirty) await this.persist(all);
  }

  async accept(id: string, loanId: string): Promise<LoanSuggestion> {
    return this.transition(id, 'accepted', loanId);
  }

  async reject(id: string): Promise<LoanSuggestion> {
    return this.transition(id, 'rejected');
  }

  async snooze(id: string): Promise<LoanSuggestion> {
    return this.transition(id, 'snoozed');
  }

  private async transition(id: string, status: LoanSuggestion['status'], loanId?: string): Promise<LoanSuggestion> {
    const all = await this.getAll();
    const idx = all.findIndex((s) => s.id === id);
    if (idx === -1) throw new NotFoundException(`Suggestion ${id} introuvable`);
    all[idx].status = status;
    all[idx].resolvedAt = new Date().toISOString();
    if (loanId) all[idx].acceptedAsLoanId = loanId;
    await this.persist(all);
    return all[idx];
  }

  private normalizePattern(p: string): string {
    return p.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  private async persist(all: LoanSuggestion[]): Promise<void> {
    await fs.promises.writeFile(this.filepath, JSON.stringify(all, null, 2), 'utf8');
    this.bus.emit('loan-suggestions-changed');
  }
}
```

- [ ] **Step 2 : Run le test**
Run: `cd backend && npm test -- loan-suggestions.service.spec`
Expected: PASS (4 tests).

- [ ] **Step 3 : Commit**
```bash
git add backend/src/modules/loan-suggestions/loan-suggestions.service{,.spec}.ts
git commit -m "feat(suggestions): implement LoanSuggestionsService"
```

### Task 5.4 : Controller + module suggestions

**Files:**
- Create: `backend/src/modules/loan-suggestions/loan-suggestions.controller.ts`
- Create: `backend/src/modules/loan-suggestions/loan-suggestions.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1 : Controller**

```ts
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { LoanSuggestionsService } from './loan-suggestions.service';

@Controller('loan-suggestions')
export class LoanSuggestionsController {
  constructor(private readonly svc: LoanSuggestionsService) {}

  @Get()
  list() { return this.svc.getPending(); }

  @Post(':id/accept')
  accept(@Param('id') id: string, @Body() body: { loanId: string }) {
    return this.svc.accept(id, body.loanId);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string) { return this.svc.reject(id); }

  @Post(':id/snooze')
  snooze(@Param('id') id: string) { return this.svc.snooze(id); }
}
```

- [ ] **Step 2 : Module**

```ts
import { Module } from '@nestjs/common';
import { LoanSuggestionsController } from './loan-suggestions.controller';
import { LoanSuggestionsService } from './loan-suggestions.service';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [EventsModule],
  controllers: [LoanSuggestionsController],
  providers: [LoanSuggestionsService],
  exports: [LoanSuggestionsService],
})
export class LoanSuggestionsModule {}
```

- [ ] **Step 3 : Wire dans `app.module.ts`** + commit
```bash
git add backend/src/modules/loan-suggestions backend/src/app.module.ts
git commit -m "feat(suggestions): wire controller + module"
```

### Task 5.5 : Étendre ANALYZE_TOOL avec `suggestedRecurringExpenses` et propager

**Files:**
- Modify: `backend/src/modules/analysis/anthropic.service.ts`
- Modify: `backend/src/modules/auto-sync/auto-sync.service.ts`
- Modify: `backend/src/modules/auto-sync/auto-sync.module.ts`

- [ ] **Step 1 : Étendre l'interface `ClaudeAnalysisResult`**

Dans `anthropic.service.ts`, repérer `interface ClaudeAnalysisResult` et ajouter :

```ts
  suggestedRecurringExpenses?: {
    label: string;
    monthlyAmount: number;
    occurrencesSeen: number;
    firstSeenDate: string;
    suggestedType: 'loan' | 'subscription' | 'utility';
    matchPattern: string;
  }[];
```

- [ ] **Step 2 : Étendre le tool schema `ANALYZE_TOOL.input_schema.properties`**

Ajouter à `properties` (et à `required` selon préférence — non requis recommandé pour rester rétrocompatible) :

```ts
      suggestedRecurringExpenses: {
        type: 'array',
        description: "Charges récurrentes détectées (≥ 2 occurrences même libellé) qui pourraient être des crédits, abonnements ou factures.",
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            monthlyAmount: { type: 'number' },
            occurrencesSeen: { type: 'number' },
            firstSeenDate: { type: 'string', description: 'YYYY-MM-DD' },
            suggestedType: { type: 'string', enum: ['loan', 'subscription', 'utility'] },
            matchPattern: { type: 'string', description: 'Regex insensible à la casse pour matcher la transaction' },
          },
          required: ['label', 'monthlyAmount', 'occurrencesSeen', 'firstSeenDate', 'suggestedType', 'matchPattern'],
        },
      },
```

- [ ] **Step 3 : Propager dans le retour**

Dans la méthode `analyzeBankStatement`, après `claudeHealthComment: p2.claudeHealthComment as string,` ajouter :

```ts
      suggestedRecurringExpenses: (p2.suggestedRecurringExpenses ?? []) as ClaudeAnalysisResult['suggestedRecurringExpenses'],
```

- [ ] **Step 4 : Injecter LoanSuggestionsService dans AutoSyncService et upsert**

Dans `auto-sync.service.ts` :

```ts
import { LoanSuggestionsService } from '../loan-suggestions/loan-suggestions.service';
// ...
  constructor(
    private readonly savings: SavingsService,
    private readonly loans: LoansService,
    private readonly suggestions: LoanSuggestionsService,
    private readonly bus: EventBusService,
  ) {}

  async syncStatement(statement: MonthlyStatement, claudeSuggestions: { label: string; monthlyAmount: number; occurrencesSeen: number; firstSeenDate: string; suggestedType: 'loan' | 'subscription' | 'utility'; matchPattern: string }[] = []): Promise<void> {
    await this.syncSavings(statement);
    await this.syncLoans(statement);
    if (claudeSuggestions.length > 0) {
      await this.suggestions.upsertMany(statement.id, claudeSuggestions);
    }
    this.bus.emit('accounts-synced');
  }
```

Mettre à jour `auto-sync.module.ts` :

```ts
imports: [SavingsModule, LoansModule, LoanSuggestionsModule, EventsModule],
```

- [ ] **Step 5 : Passer les suggestions depuis AnalysisService**

Dans `analysis.service.ts`, modifier l'appel :

```ts
    try {
      await this.autoSync.syncStatement(statement, result.suggestedRecurringExpenses ?? []);
    } catch (e) {
      this.logger.error(`AutoSync failed for ${statement.id}`, e as Error);
    }
```

- [ ] **Step 6 : Build TS et commit**

Run: `cd backend && npx tsc --noEmit -p tsconfig.json && npm test -- auto-sync.service.spec`

> Note : le test existant de `AutoSyncService` doit continuer à passer car le 2e param a une valeur par défaut `[]`.

```bash
git add backend/src/modules
git commit -m "feat(suggestions): pipeline Claude → AutoSync → LoanSuggestions"
```

### Task 5.6 : UI — encart Suggestions en haut de `/loans`

**Files:**
- Modify: `frontend/src/types/api.ts`
- Modify: `frontend/src/lib/queries.ts`
- Modify: `frontend/src/routes/loans.tsx`

- [ ] **Step 1 : Types**

Append :

```ts
export type LoanSuggestionStatus = 'pending' | 'accepted' | 'rejected' | 'snoozed';
export interface LoanSuggestion {
  id: string;
  label: string;
  monthlyAmount: number;
  occurrencesSeen: number;
  firstSeenStatementId: string;
  firstSeenDate: string;
  lastSeenDate: string;
  suggestedType: 'loan' | 'subscription' | 'utility';
  matchPattern: string;
  status: LoanSuggestionStatus;
  createdAt: string;
  resolvedAt?: string;
  acceptedAsLoanId?: string;
}
```

- [ ] **Step 2 : Hooks**

```ts
import type { LoanSuggestion } from '@/types/api';

export const qkSuggestions = { all: () => ['loan-suggestions'] as const };

export function useLoanSuggestions() {
  return useQuery({
    queryKey: qkSuggestions.all(),
    queryFn: () => api.get<LoanSuggestion[]>('/loan-suggestions'),
  });
}

export function useAcceptSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, loanId }: { id: string; loanId: string }) =>
      api.post<LoanSuggestion>(`/loan-suggestions/${id}/accept`, { loanId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qkSuggestions.all() });
      qc.invalidateQueries({ queryKey: qkLoans.all() });
    },
  });
}

export function useRejectSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<LoanSuggestion>(`/loan-suggestions/${id}/reject`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qkSuggestions.all() }),
  });
}

export function useSnoozeSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<LoanSuggestion>(`/loan-suggestions/${id}/snooze`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qkSuggestions.all() }),
  });
}
```

- [ ] **Step 3 : Encart dans `loans.tsx`**

Au-dessus des sections classiques/revolving, ajouter :

```tsx
<SuggestionsBanner onAccept={(s) => {
  // Pré-remplir le LoanForm avec les infos
  setEditing(null);
  setCreating(true);
  setPrefilled({
    name: s.label,
    type: 'classic',
    category: 'consumer',
    monthlyPayment: s.monthlyAmount,
    matchPattern: s.matchPattern,
    isActive: true,
    startDate: s.firstSeenDate,
  });
  setSuggestionToAccept(s.id);
}} />
```

Et le composant `SuggestionsBanner` :

```tsx
function SuggestionsBanner({ onAccept }: { onAccept: (s: LoanSuggestion) => void }) {
  const { data } = useLoanSuggestions();
  const reject = useRejectSuggestion();
  const snooze = useSnoozeSuggestion();
  const items = (data ?? []).filter((s) => s.status === 'pending');
  if (items.length === 0) return null;
  return (
    <div className="card p-4 mb-6 border-l-4 border-l-warning">
      <div className="font-display font-semibold text-fg-bright mb-2">
        Suggestions de Claude ({items.length})
      </div>
      <div className="space-y-2">
        {items.map((s) => (
          <div key={s.id} className="flex items-center justify-between p-2 bg-surface-2/40 rounded">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-fg-bright truncate">{s.label}</div>
              <div className="text-xs text-fg-dim tabular">
                {formatEUR(s.monthlyAmount)}/mois · vu {s.occurrencesSeen} fois · type {s.suggestedType}
              </div>
            </div>
            <div className="flex gap-1 shrink-0">
              <button onClick={() => onAccept(s)} className="btn-primary text-xs">C'est un crédit</button>
              <button onClick={() => snooze.mutate(s.id)} className="btn-ghost text-xs">Plus tard</button>
              <button onClick={() => reject.mutate(s.id)} className="btn-ghost text-xs hover:text-negative">Pas un crédit</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

> Note : `setPrefilled` et `setSuggestionToAccept` sont des nouveaux states locaux. Adapter la signature de `LoanForm` pour exposer un callback post-save qui appelle `useAcceptSuggestion().mutate({ id: suggestionToAccept, loanId: createdLoan.id })`.

Pour rester simple, modifier `handleSave` :

```tsx
const acceptSugg = useAcceptSuggestion();
const [suggestionToAccept, setSuggestionToAccept] = useState<string | null>(null);
const [prefilled, setPrefilled] = useState<LoanInput | null>(null);

const handleSave = async (input: LoanInput) => {
  let saved: Loan;
  if (editing) saved = await update.mutateAsync({ id: editing.id, input });
  else saved = await create.mutateAsync(input);
  if (suggestionToAccept) {
    await acceptSugg.mutateAsync({ id: suggestionToAccept, loanId: saved.id });
    setSuggestionToAccept(null);
  }
  setEditing(null);
  setCreating(false);
  setPrefilled(null);
};

// Et dans le rendu du form :
{(creating || editing) && (
  <LoanForm
    init={prefilled ?? (editing ? toInput(editing) : DEFAULT)}
    onSave={handleSave}
    onCancel={() => { setCreating(false); setEditing(null); setPrefilled(null); setSuggestionToAccept(null); }}
    busy={create.isPending || update.isPending}
  />
)}
```

- [ ] **Step 4 : Build TS et commit**

Run: `cd frontend && npx tsc -b --noEmit`

```bash
git add frontend/src/{types/api.ts,lib/queries.ts,routes/loans.tsx}
git commit -m "feat(suggestions): UI banner with accept/reject/snooze actions"
```

### Task 5.7 : E2E Phase 5
- Importer un relevé contenant 2× `PRELEVT CETELEM 320 €`. Vérifier qu'une suggestion apparaît sur `/loans`. Cliquer "C'est un crédit", remplir le form. Vérifier que la suggestion disparaît et que le crédit apparaît dans la section classiques.
```bash
git tag v3-phase5-done
```

---

## Phase 6 — Renommage `/recurring` → `/income` + tile dashboard "Entrées"

**Pré-requis :** aucun (cosmétique). Préférable après les phases backend pour éviter les conflits de merge.

### Task 6.1 : Renommer le composant et la route

**Files:**
- Rename: `frontend/src/routes/recurring.tsx` → `frontend/src/routes/income.tsx`
- Modify: `frontend/src/router.tsx`
- Modify: `frontend/src/components/layout/sidebar.tsx`

- [ ] **Step 1 : `git mv` du fichier**

```bash
git mv frontend/src/routes/recurring.tsx frontend/src/routes/income.tsx
```

- [ ] **Step 2 : Renommer le composant `RecurringPage` → `IncomePage` dans `income.tsx`**

Dans `income.tsx`, remplacer toutes les occurrences de `RecurringPage` par `IncomePage`. Modifier l'eyebrow `'Crédits récurrents'` en `'Revenus'` et le subtitle pour rester cohérent.

```tsx
<PageHeader
  eyebrow="Revenus"
  title={`${formatEUR(total)} / mois`}
  subtitle={`${items.filter((c) => c.isActive).length} revenu${items.length > 1 ? 's' : ''} récurrent${items.length > 1 ? 's' : ''} détecté${items.length > 1 ? 's' : ''}.`}
/>
```

- [ ] **Step 3 : `router.tsx`**

Remplacer :
```tsx
import { RecurringPage } from './routes/recurring';
// ...
const recurringRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/recurring',
  component: RecurringPage,
});
```
Par :
```tsx
import { IncomePage } from './routes/income';
// ...
const incomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/income',
  component: IncomePage,
});
```

Et dans `routeTree.addChildren`, remplacer `recurringRoute` par `incomeRoute`.

- [ ] **Step 4 : Ajouter un redirect `/recurring` → `/income`**

Dans `router.tsx`, ajouter une nouvelle route :

```tsx
import { Navigate } from '@tanstack/react-router';
// ...
const recurringRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/recurring',
  component: () => <Navigate to="/income" replace />,
});
```

L'ajouter au `routeTree.addChildren([..., recurringRedirectRoute])`.

- [ ] **Step 5 : `sidebar.tsx`**

Remplacer l'item `{ to: '/recurring', label: 'Crédits récurrents', icon: Repeat, ... }` par :
```tsx
{ to: '/income', label: 'Revenus', icon: Repeat, exact: false },
```

- [ ] **Step 6 : Build TS + commit**

Run: `cd frontend && npx tsc -b --noEmit`

```bash
git add frontend/src/{routes/income.tsx,router.tsx,components/layout/sidebar.tsx}
git commit -m "refactor(ui): rename /recurring to /income with redirect"
```

### Task 6.2 : Renommer tile "Crédits" → "Entrées" sur le dashboard

**Files:**
- Modify: `frontend/src/routes/index.tsx`

- [ ] **Step 1 : Modifier le label**

Localiser dans `index.tsx` :
```tsx
        <StatCard
          label="Crédits"
          value={formatEUR(current.totalCredits)}
          icon={<ArrowUpRight className="h-4 w-4 text-positive" />}
          tone="positive"
        />
```

Remplacer `label="Crédits"` par `label="Entrées"`.

- [ ] **Step 2 : Commit**

```bash
git add frontend/src/routes/index.tsx
git commit -m "refactor(dashboard): rename 'Crédits' tile to 'Entrées' to disambiguate"
```

### Task 6.3 : Ajouter tiles "Patrimoine épargne" + "Charge crédits" au dashboard

**Files:**
- Modify: `frontend/src/routes/index.tsx`

- [ ] **Step 1 : Ajouter les imports en haut**

```tsx
import { useSavingsAccounts, useLoans } from '@/lib/queries';
import { PiggyBank, CreditCard } from 'lucide-react';
```

- [ ] **Step 2 : Ajouter les data hooks dans `DashboardPage`**

Après `const claude = useClaudeUsage();` :

```tsx
  const savings = useSavingsAccounts();
  const loans = useLoans();

  const totalSavings = (savings.data ?? []).reduce((s, a) => s + a.currentBalance, 0);
  const activeLoans = (loans.data ?? []).filter((l) => l.isActive);
  const totalMonthlyLoans = activeLoans.reduce((s, l) => s + l.monthlyPayment, 0);
```

- [ ] **Step 3 : Ajouter les 2 tiles au-dessous de "Solde de clôture"**

Après le `<StatCard label="Solde de clôture" ... />` :

```tsx
        <StatCard
          label="Patrimoine épargne"
          value={formatEUR(totalSavings)}
          icon={<PiggyBank className="h-4 w-4 text-accent" />}
          tone="positive"
        />
        <StatCard
          label="Charge crédits"
          value={`${formatEUR(totalMonthlyLoans)} / mois`}
          icon={<CreditCard className="h-4 w-4 text-warning" />}
          tone="negative"
        />
```

> Ajuster la grille `grid-cols-1 lg:grid-cols-3` en `lg:grid-cols-3 xl:grid-cols-4` si besoin de place.

- [ ] **Step 4 : Build + commit**

Run: `cd frontend && npx tsc -b --noEmit`

```bash
git add frontend/src/routes/index.tsx
git commit -m "feat(dashboard): add Patrimoine épargne + Charge crédits tiles"
```

### Task 6.4 : E2E Phase 6
- Vérifier visuellement http://nas:4200 : sidebar montre "Revenus" et le dashboard a 6 tiles dont les 2 nouveaux. Le redirect `/recurring` → `/income` fonctionne.
```bash
git tag v3-phase6-done
```

---

## Phase 7 — Bonus (a) Patrimoine net, (b) Alertes, (e) Vue annuelle enrichie

**Pré-requis :** Phase 6.

### Task 7.1 (a) Patrimoine net — endpoint backend

**Files:**
- Create: `backend/src/modules/dashboard/dashboard.service.ts`
- Create: `backend/src/modules/dashboard/dashboard.controller.ts`
- Create: `backend/src/modules/dashboard/dashboard.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1 : Service**

```ts
import { Injectable } from '@nestjs/common';
import { SavingsService } from '../savings/savings.service';
import { LoansService } from '../loans/loans.service';
import { StorageService } from '../storage/storage.service';

export interface NetWorth {
  closingBalance: number;
  totalSavings: number;
  estimatedDebt: number;
  netWorth: number;
  ignoredLoanIds: string[];
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly savings: SavingsService,
    private readonly loans: LoansService,
    private readonly storage: StorageService,
  ) {}

  async getNetWorth(): Promise<NetWorth> {
    const [savings, loans, summaries] = await Promise.all([
      this.savings.getAll(),
      this.loans.getAll(),
      this.storage.getAllSummaries(),
    ]);
    const closing = summaries[0]?.closingBalance ?? 0;
    const totalSavings = savings.reduce((s, a) => s + a.currentBalance, 0);

    const ignoredLoanIds: string[] = [];
    let estimatedDebt = 0;
    const now = new Date();
    for (const l of loans.filter((x) => x.isActive && x.type === 'classic')) {
      if (!l.endDate || !l.monthlyPayment) {
        ignoredLoanIds.push(l.id);
        continue;
      }
      const end = new Date(l.endDate);
      const monthsRemaining = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30.44)));
      estimatedDebt += monthsRemaining * l.monthlyPayment;
    }
    // Revolving = solde utilisé est une dette
    for (const l of loans.filter((x) => x.isActive && x.type === 'revolving')) {
      estimatedDebt += l.usedAmount ?? 0;
    }

    const netWorth = Math.round((closing + totalSavings - estimatedDebt) * 100) / 100;
    return {
      closingBalance: closing,
      totalSavings: Math.round(totalSavings * 100) / 100,
      estimatedDebt: Math.round(estimatedDebt * 100) / 100,
      netWorth,
      ignoredLoanIds,
    };
  }

  async getAlerts(): Promise<Alert[]> {
    const alerts: Alert[] = [];
    const [loans, summaries] = await Promise.all([this.loans.getAll(), this.storage.getAllSummaries()]);
    // Revolving > 80%
    for (const l of loans.filter((x) => x.isActive && x.type === 'revolving')) {
      if (l.maxAmount && l.usedAmount != null) {
        const pct = (l.usedAmount / l.maxAmount) * 100;
        if (pct >= 80) alerts.push({
          severity: pct >= 95 ? 'critical' : 'warning',
          message: `Revolving "${l.name}" à ${Math.round(pct)}% du plafond`,
          link: '/loans',
        });
      }
    }
    // Solde -30% vs mois précédent
    if (summaries.length >= 2) {
      const a = summaries[0].closingBalance, b = summaries[1].closingBalance;
      if (b > 0 && (a / b) <= 0.7) {
        alerts.push({
          severity: 'warning',
          message: `Solde en baisse de ${Math.round((1 - a / b) * 100)}% vs mois précédent`,
          link: '/history',
        });
      }
    }
    // Crédit < 90 jours
    const now = new Date();
    for (const l of loans.filter((x) => x.isActive && x.type === 'classic' && x.endDate)) {
      const days = (new Date(l.endDate!).getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      if (days > 0 && days < 90) {
        alerts.push({
          severity: 'info',
          message: `Crédit "${l.name}" se termine dans ${Math.round(days)} jours`,
          link: '/loans',
        });
      }
    }
    return alerts;
  }

  async getYearlyOverview(months = 12): Promise<YearlyOverview> {
    const summaries = (await this.storage.getAllSummaries()).slice(0, months).reverse();
    const monthly = summaries.map((s) => ({
      month: `${s.year}-${String(s.month).padStart(2, '0')}`,
      credits: s.totalCredits,
      debits: s.totalDebits,
      net: s.totalCredits - s.totalDebits,
    }));

    // Top 5 catégories sur fenêtre glissante
    const fullStatements = (await this.storage.getAllStatements()).slice(0, months);
    const catTotals = new Map<string, number>();
    for (const s of fullStatements) {
      for (const t of s.transactions) {
        if (t.amount < 0) {
          catTotals.set(t.category, (catTotals.get(t.category) ?? 0) + Math.abs(t.amount));
        }
      }
    }
    const topCategories = [...catTotals.entries()]
      .map(([category, total]) => ({ category, total: Math.round(total * 100) / 100 }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    return { monthly, topCategories };
  }
}

export type AlertSeverity = 'info' | 'warning' | 'critical';
export interface Alert { severity: AlertSeverity; message: string; link?: string; }

export interface YearlyOverview {
  monthly: { month: string; credits: number; debits: number; net: number }[];
  topCategories: { category: string; total: number }[];
}
```

- [ ] **Step 2 : Controller**

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly svc: DashboardService) {}

  @Get('net-worth')
  netWorth() { return this.svc.getNetWorth(); }

  @Get('alerts')
  alerts() { return this.svc.getAlerts(); }

  @Get('yearly-overview')
  yearly(@Query('months') months?: string) {
    return this.svc.getYearlyOverview(months ? parseInt(months, 10) : 12);
  }
}
```

- [ ] **Step 3 : Module**

```ts
import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { SavingsModule } from '../savings/savings.module';
import { LoansModule } from '../loans/loans.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [SavingsModule, LoansModule, StorageModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
```

- [ ] **Step 4 : Wire dans `app.module.ts`** + commit

```bash
git add backend/src/modules/dashboard backend/src/app.module.ts
git commit -m "feat(dashboard): add net-worth, alerts, yearly-overview endpoints"
```

### Task 7.2 : Hooks frontend + UI

**Files:**
- Modify: `frontend/src/types/api.ts`
- Modify: `frontend/src/lib/queries.ts`
- Modify: `frontend/src/routes/index.tsx`

- [ ] **Step 1 : Types**

```ts
export interface NetWorth {
  closingBalance: number;
  totalSavings: number;
  estimatedDebt: number;
  netWorth: number;
  ignoredLoanIds: string[];
}
export type AlertSeverity = 'info' | 'warning' | 'critical';
export interface DashboardAlert { severity: AlertSeverity; message: string; link?: string }
export interface YearlyOverview {
  monthly: { month: string; credits: number; debits: number; net: number }[];
  topCategories: { category: string; total: number }[];
}
```

- [ ] **Step 2 : Hooks**

```ts
export function useNetWorth() {
  return useQuery({ queryKey: ['dashboard', 'net-worth'], queryFn: () => api.get<NetWorth>('/dashboard/net-worth') });
}
export function useAlerts() {
  return useQuery({ queryKey: ['dashboard', 'alerts'], queryFn: () => api.get<DashboardAlert[]>('/dashboard/alerts') });
}
export function useYearlyOverview(months = 12) {
  return useQuery({ queryKey: ['dashboard', 'yearly', months], queryFn: () => api.get<YearlyOverview>(`/dashboard/yearly-overview?months=${months}`) });
}
```

- [ ] **Step 3 : Bloc Patrimoine net en haut du dashboard**

Dans `index.tsx`, sous le `<PageHeader>` et avant la grille de tiles :

```tsx
const netWorth = useNetWorth();
// ...
{netWorth.data && (
  <div className="card p-6 mb-6 bg-gradient-to-r from-surface to-surface-2/40">
    <div className="flex items-center justify-between flex-wrap gap-3">
      <div>
        <div className="stat-label">Patrimoine net</div>
        <div className="font-display text-display-lg font-bold tabular text-fg-bright mt-1">
          {formatEUR(netWorth.data.netWorth)}
        </div>
        <div className="text-xs text-fg-dim mt-1">
          {formatEUR(netWorth.data.closingBalance)} compte courant + {formatEUR(netWorth.data.totalSavings)} épargne − {formatEUR(netWorth.data.estimatedDebt)} dettes estimées
        </div>
      </div>
      {netWorth.data.ignoredLoanIds.length > 0 && (
        <div className="text-xs text-warning max-w-xs">
          ⚠ {netWorth.data.ignoredLoanIds.length} crédit(s) ignoré(s) (date de fin manquante)
        </div>
      )}
    </div>
  </div>
)}
```

- [ ] **Step 4 : Bloc Alertes**

```tsx
const alerts = useAlerts();
// ...
{(alerts.data?.length ?? 0) > 0 && (
  <div className="card p-4 mb-6 border-l-4 border-l-warning">
    <div className="font-display font-semibold text-fg-bright mb-2">Alertes ({alerts.data!.length})</div>
    <div className="space-y-1.5">
      {alerts.data!.map((a, i) => (
        <div key={i} className={cn(
          'text-sm flex items-center gap-2',
          a.severity === 'critical' && 'text-negative',
          a.severity === 'warning' && 'text-warning',
          a.severity === 'info' && 'text-fg-muted',
        )}>
          <span>{a.severity === 'critical' ? '🔴' : a.severity === 'warning' ? '🟠' : 'ℹ️'}</span>
          {a.link ? <Link to={a.link} className="hover:underline">{a.message}</Link> : <span>{a.message}</span>}
        </div>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 5 : Bloc Vue annuelle enrichie en bas**

```tsx
const yearly = useYearlyOverview(12);
// ...
{yearly.data && yearly.data.monthly.length >= 2 && (
  <section className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
    <div className="card p-5">
      <div className="stat-label mb-3">Entrées / sorties (12 mois glissants)</div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={yearly.data.monthly}>
            <XAxis dataKey="month" tick={{ fill: 'hsl(var(--fg-dim))', fontSize: 10 }} />
            <YAxis tick={{ fill: 'hsl(var(--fg-dim))', fontSize: 10 }} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
            <Tooltip contentStyle={{ background: 'hsl(var(--surface-2))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 12 }} />
            <Bar dataKey="credits" fill="hsl(160 84% 50%)" />
            <Bar dataKey="debits" fill="hsl(0 70% 55%)" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
    <div className="card p-5">
      <div className="stat-label mb-3">Top 5 postes de dépense (12 mois)</div>
      <div className="space-y-2">
        {yearly.data.topCategories.map((c) => (
          <div key={c.category} className="flex items-center justify-between text-sm">
            <span className="text-fg-muted">{CATEGORY_LABELS[c.category as TransactionCategory] ?? c.category}</span>
            <span className="font-display tabular text-fg-bright">{formatEUR(c.total)}</span>
          </div>
        ))}
      </div>
    </div>
  </section>
)}
```

(Importer `BarChart, Bar` depuis `recharts`.)

- [ ] **Step 6 : Build TS + commit**

Run: `cd frontend && npx tsc -b --noEmit`

```bash
git add frontend/src/{types/api.ts,lib/queries.ts,routes/index.tsx}
git commit -m "feat(dashboard): add net worth, alerts, yearly overview UI"
```

### Task 7.3 : E2E Phase 7
- Vérifier dashboard : bloc Patrimoine net en haut, alertes si seuils franchis, graphes annuels en bas.
```bash
git tag v3-phase7-done
```

---

## Phase 8 — Mode démo (isolé, fixtures déterministes)

**Pré-requis :** toutes les phases précédentes (le dataset démo doit couvrir épargne + crédits + suggestions).

**Coût attention :** cette phase touche `StorageService` (refactor `Scope.REQUEST`). Tester soigneusement avant de merger.

### File Structure

| Path | Responsabilité |
|------|----------------|
| `backend/src/modules/demo/demo.module.ts` | Wiring |
| `backend/src/modules/demo/demo.controller.ts` | Endpoints `/api/demo/*` |
| `backend/src/modules/demo/demo-seed.service.ts` | Génération fixtures |
| `backend/src/modules/demo/demo-mode.middleware.ts` | Détecte header `X-Demo-Mode` |
| `backend/src/modules/demo/request-data-dir.service.ts` | Provider `Scope.REQUEST` |
| `backend/src/modules/demo/demo-fixtures.json` | Dataset versionné |
| `backend/src/config/configuration.ts` | Ajout `demoModeAvailable` |
| `frontend/src/lib/demo.ts` | Toggle + gestion sessionStorage |
| `frontend/src/lib/api.ts` | Header `X-Demo-Mode` automatique |
| `frontend/src/components/layout/top-bar.tsx` | Toggle UI + banner |

### Task 8.1 : Refactor StorageService en `Scope.REQUEST` via RequestDataDirService

**Files:**
- Create: `backend/src/modules/demo/request-data-dir.service.ts`
- Modify: `backend/src/modules/storage/storage.service.ts`
- Modify: `backend/src/modules/storage/storage.module.ts`

> **Note critique** : ce refactor casse en cascade tous les services qui injectent `StorageService` (DeclarationsService, SnapshotService, etc.). Pour limiter le blast radius, l'approche retenue est **différente du design initial** :
>
> Au lieu de scoper `StorageService` en `REQUEST`, on garde `StorageService` en singleton mais on l'instancie avec un `RequestDataDirService` qui résout `dataDir` à chaque appel via le contexte HTTP courant (stocké dans un `AsyncLocalStorage` Node).
>
> Cette approche est moins disruptive et plus performante.

- [ ] **Step 1 : Créer le RequestDataDirService basé sur AsyncLocalStorage**

```ts
// backend/src/modules/demo/request-data-dir.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AsyncLocalStorage } from 'async_hooks';
import * as path from 'path';

interface RequestContext {
  demoMode: boolean;
}

@Injectable()
export class RequestDataDirService {
  private readonly als = new AsyncLocalStorage<RequestContext>();

  constructor(private readonly config: ConfigService) {}

  runWith<T>(ctx: RequestContext, fn: () => T): T {
    return this.als.run(ctx, fn);
  }

  isDemoMode(): boolean {
    return this.als.getStore()?.demoMode ?? false;
  }

  getDataDir(): string {
    const baseDir = this.config.get<string>('dataDir')!;
    return this.isDemoMode() ? path.join(baseDir, 'demo') : baseDir;
  }
}
```

- [ ] **Step 2 : Refactor `StorageService` pour utiliser `getDataDir()` à chaque appel**

Dans `storage.service.ts`, remplacer la lecture statique par un getter :

```ts
import { RequestDataDirService } from '../demo/request-data-dir.service';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);

  constructor(
    private config: ConfigService,
    private dataDir: RequestDataDirService,
  ) {}

  onModuleInit() {
    // S'assurer que les répertoires de base existent (mode normal + démo).
    const real = this.config.get<string>('dataDir')!;
    for (const root of [real, path.join(real, 'demo')]) {
      fs.mkdirSync(path.join(root, 'statements', 'archive'), { recursive: true });
      fs.mkdirSync(path.join(root, 'uploads'), { recursive: true });
      fs.mkdirSync(path.join(root, 'yearly'), { recursive: true });
    }
  }

  // Helpers de chemins dynamiques :
  private get statementsDir() { return path.resolve(this.dataDir.getDataDir(), 'statements'); }
  private get archiveDir() { return path.resolve(this.statementsDir, 'archive'); }
  private get yearlyDir() { return path.resolve(this.dataDir.getDataDir(), 'yearly'); }
}
```

> Idem pour tous les autres services qui hardcodent `dataDir` dans leur `onModuleInit` (`DeclarationsService`, `SavingsService`, `LoansService`, `LoanSuggestionsService`, `SnapshotService`) : **convertir leurs `private filepath` en getter dynamique** :

```ts
// Ex pour SavingsService :
constructor(
  private readonly config: ConfigService,
  private readonly bus: EventBusService,
  private readonly dataDir: RequestDataDirService,
) {}

onModuleInit() {
  // No-op, le filepath est calculé à chaque accès
}

private get filepath(): string {
  return path.resolve(this.dataDir.getDataDir(), 'savings-accounts.json');
}
```

Appliquer ce pattern à : `DeclarationsService`, `SavingsService`, `LoansService`, `LoanSuggestionsService`, `SnapshotService`, `ClaudeUsageService`. Pour chacun :
1. Injecter `RequestDataDirService`.
2. Vider `onModuleInit()` (ou laisser que la création de répertoires neutres).
3. Convertir `private filepath` en getter.

- [ ] **Step 3 : Mettre à jour `storage.module.ts` et tous les modules concernés**

Pour chaque module (`StorageModule`, `DeclarationsModule`, `SavingsModule`, `LoansModule`, `LoanSuggestionsModule`, `SnapshotsModule`, `ClaudeUsageModule`), ajouter `DemoModule` (qui exporte `RequestDataDirService`) en `imports`.

Créer d'abord `backend/src/modules/demo/demo.module.ts` :

```ts
import { Module, Global } from '@nestjs/common';
import { RequestDataDirService } from './request-data-dir.service';

@Global()
@Module({
  providers: [RequestDataDirService],
  exports: [RequestDataDirService],
})
export class DemoCoreModule {}
```

Et l'importer **avant tous les autres** dans `app.module.ts` (avant `StorageModule`, etc.).

> Le `@Global()` évite d'avoir à l'importer dans chaque sous-module.

- [ ] **Step 4 : Update tests existants**

Les tests qui injectent `ConfigService` doivent maintenant aussi injecter `RequestDataDirService` :

```ts
// Pattern dans chaque .spec.ts qui touche un service refactoré :
const fakeRdds = {
  getDataDir: () => tmpDir,
  isDemoMode: () => false,
  runWith: (_ctx: any, fn: any) => fn(),
};

const mod = await Test.createTestingModule({
  providers: [
    SavingsService,
    { provide: ConfigService, useValue: { get: (k: string) => k === 'dataDir' ? tmpDir : null } },
    { provide: EventBusService, useValue: { emit: jest.fn() } },
    { provide: RequestDataDirService, useValue: fakeRdds },
  ],
}).compile();
```

Mettre à jour tous les `.spec.ts` créés en Phases 2-5.

- [ ] **Step 5 : Run all tests**

Run: `cd backend && npm test`
Expected: tous les tests passent.

- [ ] **Step 6 : Commit**

```bash
git add backend/src
git commit -m "refactor(storage): dynamic dataDir via RequestDataDirService (AsyncLocalStorage)"
```

### Task 8.2 : Middleware `DemoModeMiddleware`

**Files:**
- Create: `backend/src/modules/demo/demo-mode.middleware.ts`
- Modify: `backend/src/main.ts`

- [ ] **Step 1 : Middleware**

```ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';
import { RequestDataDirService } from './request-data-dir.service';

@Injectable()
export class DemoModeMiddleware implements NestMiddleware {
  constructor(
    private readonly dataDir: RequestDataDirService,
    private readonly config: ConfigService,
  ) {}

  use(req: Request, res: Response, next: NextFunction) {
    const available = this.config.get<boolean>('demoModeAvailable') ?? true;
    const headerValue = req.header('X-Demo-Mode');
    const demoMode = available && headerValue === 'true';
    this.dataDir.runWith({ demoMode }, () => next());
  }
}
```

- [ ] **Step 2 : Configuration env**

Modifier `backend/src/config/configuration.ts` :

```ts
  demoModeAvailable: process.env.DEMO_MODE_AVAILABLE !== 'false',
```

- [ ] **Step 3 : Brancher le middleware globalement**

Dans `app.module.ts`, implémenter `NestModule` :

```ts
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { DemoModeMiddleware } from './modules/demo/demo-mode.middleware';

@Module({ /* ... */ })
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(DemoModeMiddleware).forRoutes('*');
  }
}
```

- [ ] **Step 4 : Build TS + commit**

```bash
git add backend/src
git commit -m "feat(demo): add DemoModeMiddleware reading X-Demo-Mode header"
```

### Task 8.3 : Dataset démo + DemoSeedService

**Files:**
- Create: `backend/src/modules/demo/demo-fixtures.json`
- Create: `backend/src/modules/demo/demo-seed.service.ts`
- Create: `backend/src/modules/demo/demo.controller.ts`
- Create: `backend/src/modules/demo/demo.module.ts`

- [ ] **Step 1 : Fixtures déterministes**

Créer `backend/src/modules/demo/demo-fixtures.json` (extrait — l'engineer génère le contenu complet en suivant cette structure) :

```json
{
  "statements": [
    {
      "id": "2026-04",
      "month": 4, "year": 2026,
      "uploadedAt": "2026-05-01T10:00:00Z",
      "bankName": "Banque Démo", "accountHolder": "Alex Démo", "currency": "EUR",
      "openingBalance": 1240.55, "closingBalance": 1187.20,
      "totalCredits": 2867.00, "totalDebits": 2920.35,
      "transactions": [
        { "id": "demo-tx-001", "date": "2026-04-02", "description": "VIR SALAIRE ENTREPRISE DEMO", "normalizedDescription": "vir salaire entreprise demo", "amount": 2800, "currency": "EUR", "category": "income", "subcategory": "salary", "isRecurring": true, "confidence": 1 },
        { "id": "demo-tx-002", "date": "2026-04-05", "description": "VIR PEL DEMO", "normalizedDescription": "vir pel demo", "amount": -100, "currency": "EUR", "category": "savings", "subcategory": "", "isRecurring": true, "confidence": 1 },
        { "id": "demo-tx-003", "date": "2026-04-10", "description": "PRELEVT CETELEM AUTO", "normalizedDescription": "prelevt cetelem auto", "amount": -240, "currency": "EUR", "category": "subscriptions", "subcategory": "loan", "isRecurring": true, "confidence": 1 },
        { "id": "demo-tx-004", "date": "2026-04-15", "description": "PRELEVT COFIDIS", "normalizedDescription": "prelevt cofidis", "amount": -80, "currency": "EUR", "category": "subscriptions", "subcategory": "loan", "isRecurring": true, "confidence": 1 }
      ],
      "healthScore": { "total": 74, "breakdown": { "savingsRate": 70, "expenseControl": 75, "debtBurden": 65, "cashFlowBalance": 80, "irregularSpending": 80 }, "trend": "stable", "claudeComment": "Bonne maîtrise globale. Attention au revolving qui approche 40% du plafond." },
      "recurringCredits": [],
      "analysisNarrative": "Mois équilibré, épargne régulière maintenue."
    }
  ],
  "savings-accounts": [
    {
      "id": "demo-pel-1", "name": "PEL Démo", "type": "pel",
      "initialBalance": 12000, "initialBalanceDate": "2018-03-15",
      "matchPattern": "VIR.*PEL", "interestRate": 0.02, "interestAnniversaryMonth": 3,
      "currentBalance": 12450, "lastSyncedStatementId": "2026-04",
      "movements": [
        { "id": "m-1", "date": "2018-03-15", "amount": 12000, "source": "initial", "statementId": null, "transactionId": null }
      ],
      "createdAt": "2026-05-01T00:00:00Z", "updatedAt": "2026-05-01T00:00:00Z"
    },
    {
      "id": "demo-livreta-1", "name": "Livret A Démo", "type": "livret-a",
      "initialBalance": 6000, "initialBalanceDate": "2025-12-01",
      "matchPattern": "VIR.*LIVRET", "interestRate": 0.015, "interestAnniversaryMonth": 12,
      "currentBalance": 6200, "lastSyncedStatementId": "2026-04",
      "movements": [],
      "createdAt": "2026-05-01T00:00:00Z", "updatedAt": "2026-05-01T00:00:00Z"
    }
  ],
  "loans": [
    {
      "id": "demo-loan-auto", "name": "Crédit auto Démo", "type": "classic", "category": "auto",
      "monthlyPayment": 240, "matchPattern": "PRELEVT.*CETELEM.*AUTO", "isActive": true,
      "startDate": "2025-03-01", "endDate": "2028-03-01", "initialPrincipal": 8640,
      "occurrencesDetected": [],
      "createdAt": "2026-05-01T00:00:00Z", "updatedAt": "2026-05-01T00:00:00Z"
    },
    {
      "id": "demo-loan-revolving", "name": "Carte magasin Démo", "type": "revolving", "category": "consumer",
      "monthlyPayment": 80, "matchPattern": "PRELEVT.*COFIDIS", "isActive": true,
      "maxAmount": 3000, "usedAmount": 1200,
      "occurrencesDetected": [],
      "createdAt": "2026-05-01T00:00:00Z", "updatedAt": "2026-05-01T00:00:00Z"
    }
  ],
  "loan-suggestions": [],
  "declarations": [],
  "budgets": { "food": 400, "entertainment": 100 }
}
```

> L'engineer doit étoffer pour avoir **6 statements** (mois M-5 à M, soit nov 2025 → avr 2026) avec montants cohérents. Chaque statement contient ~15-25 transactions. Les patterns `VIR PEL`, `VIR LIVRET`, `PRELEVT CETELEM`, `PRELEVT COFIDIS` doivent être systématiques pour que l'AutoSync fonctionne.

- [ ] **Step 2 : Service de seed**

```ts
// backend/src/modules/demo/demo-seed.service.ts
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import fixtures from './demo-fixtures.json';

@Injectable()
export class DemoSeedService {
  private readonly logger = new Logger(DemoSeedService.name);

  constructor(private readonly config: ConfigService) {}

  async seed(force = false): Promise<{ seeded: boolean; reason?: string }> {
    const demoDir = path.join(this.config.get<string>('dataDir')!, 'demo');
    const sentinel = path.join(demoDir, '.seeded');
    if (!force && fs.existsSync(sentinel)) {
      return { seeded: false, reason: 'already-seeded' };
    }
    fs.mkdirSync(path.join(demoDir, 'statements', 'archive'), { recursive: true });
    fs.mkdirSync(path.join(demoDir, 'yearly'), { recursive: true });
    fs.mkdirSync(path.join(demoDir, 'uploads'), { recursive: true });

    for (const stmt of (fixtures as any).statements) {
      fs.writeFileSync(path.join(demoDir, 'statements', `${stmt.id}.json`), JSON.stringify(stmt, null, 2));
    }
    fs.writeFileSync(path.join(demoDir, 'savings-accounts.json'), JSON.stringify((fixtures as any)['savings-accounts'], null, 2));
    fs.writeFileSync(path.join(demoDir, 'loans.json'), JSON.stringify((fixtures as any).loans, null, 2));
    fs.writeFileSync(path.join(demoDir, 'loan-suggestions.json'), JSON.stringify((fixtures as any)['loan-suggestions'], null, 2));
    fs.writeFileSync(path.join(demoDir, 'declarations.json'), JSON.stringify((fixtures as any).declarations, null, 2));
    fs.writeFileSync(path.join(demoDir, 'budgets.json'), JSON.stringify((fixtures as any).budgets, null, 2));
    fs.writeFileSync(sentinel, new Date().toISOString());
    this.logger.log(`Demo seeded at ${demoDir}`);
    return { seeded: true };
  }

  async reset(): Promise<void> {
    const demoDir = path.join(this.config.get<string>('dataDir')!, 'demo');
    if (fs.existsSync(demoDir)) {
      fs.rmSync(demoDir, { recursive: true, force: true });
      this.logger.log(`Demo reset at ${demoDir}`);
    }
  }

  status(): { available: boolean; seeded: boolean } {
    const available = this.config.get<boolean>('demoModeAvailable') ?? true;
    const sentinel = path.join(this.config.get<string>('dataDir')!, 'demo', '.seeded');
    return { available, seeded: fs.existsSync(sentinel) };
  }
}
```

> Configurer `tsconfig.json` pour autoriser `"resolveJsonModule": true` (probablement déjà OK dans NestJS).

- [ ] **Step 3 : Controller**

```ts
// backend/src/modules/demo/demo.controller.ts
import { Controller, Delete, Get, HttpCode, Post, Query } from '@nestjs/common';
import { DemoSeedService } from './demo-seed.service';

@Controller('demo')
export class DemoController {
  constructor(private readonly seed: DemoSeedService) {}

  @Get('status')
  status() { return this.seed.status(); }

  @Post('seed')
  doSeed(@Query('force') force?: string) { return this.seed.seed(force === 'true'); }

  @Delete('data')
  @HttpCode(204)
  async reset(): Promise<void> { await this.seed.reset(); }
}
```

- [ ] **Step 4 : Module**

```ts
// backend/src/modules/demo/demo.module.ts (séparé de DemoCoreModule)
import { Module } from '@nestjs/common';
import { DemoController } from './demo.controller';
import { DemoSeedService } from './demo-seed.service';

@Module({
  controllers: [DemoController],
  providers: [DemoSeedService],
})
export class DemoModule {}
```

Wire dans `app.module.ts` (DemoCoreModule + DemoModule).

- [ ] **Step 5 : Bypass middleware pour `/api/demo/*` et `/api/health`**

Le `DemoModeMiddleware` ne doit pas appliquer le mode démo aux endpoints `/api/demo/*` (sinon on ne pourrait pas reset les données réelles). Modifier `app.module.ts` :

```ts
configure(consumer: MiddlewareConsumer) {
  consumer
    .apply(DemoModeMiddleware)
    .exclude({ path: 'demo/(.*)', method: RequestMethod.ALL }, { path: 'health', method: RequestMethod.ALL })
    .forRoutes('*');
}
```

- [ ] **Step 6 : Commit**

```bash
git add backend/src
git commit -m "feat(demo): add seed service, fixtures, controller"
```

### Task 8.4 : Frontend toggle + banner + intercepteur

**Files:**
- Create: `frontend/src/lib/demo.ts`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/components/layout/top-bar.tsx`
- Modify: `frontend/src/components/layout/app-shell.tsx` (banner)

- [ ] **Step 1 : Store demo**

```ts
// frontend/src/lib/demo.ts
const KEY = 'demoMode';

export const demoStore = {
  isActive(): boolean {
    return typeof window !== 'undefined' && window.sessionStorage.getItem(KEY) === 'true';
  },
  enable() {
    window.sessionStorage.setItem(KEY, 'true');
    window.location.reload();
  },
  disable() {
    window.sessionStorage.removeItem(KEY);
    window.location.reload();
  },
};
```

- [ ] **Step 2 : Intercepteur dans `api.ts`**

Dans `request<T>` après les autres headers :

```ts
import { demoStore } from './demo';
// ...
  if (demoStore.isActive()) headers['X-Demo-Mode'] = 'true';
```

- [ ] **Step 3 : Toggle dans top-bar**

Lire `top-bar.tsx` puis ajouter un bouton (icône `Drama` de lucide) :

```tsx
import { Drama } from 'lucide-react';
import { demoStore } from '@/lib/demo';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ...
const demoStatus = useQuery({
  queryKey: ['demo', 'status'],
  queryFn: () => api.get<{ available: boolean; seeded: boolean }>('/demo/status'),
});
const demoOn = demoStore.isActive();

const handleToggle = async () => {
  if (demoOn) demoStore.disable();
  else {
    if (!demoStatus.data?.seeded) await api.post('/demo/seed');
    demoStore.enable();
  }
};

// dans le JSX :
{demoStatus.data?.available && (
  <button onClick={handleToggle} className={cn('btn-ghost', demoOn && 'text-warning')}>
    <Drama className="h-4 w-4" />
    {demoOn ? 'Quitter démo' : 'Mode démo'}
  </button>
)}
```

- [ ] **Step 4 : Banner orange dans `app-shell.tsx`**

```tsx
import { demoStore } from '@/lib/demo';
// ...
{demoStore.isActive() && (
  <div className="bg-warning/20 border-b border-warning text-warning px-6 py-2 text-sm font-medium text-center">
    🎭 Mode démo actif — données fictives. <button onClick={() => demoStore.disable()} className="underline ml-2">Quitter</button>
  </div>
)}
```

- [ ] **Step 5 : Build + commit**

```bash
git add frontend/src
git commit -m "feat(demo): UI toggle, banner, X-Demo-Mode header interceptor"
```

### Task 8.5 : Test e2e Phase 8

- [ ] Vérifier `GET /api/demo/status` → `{ available: true, seeded: false }`.
- [ ] Activer le mode démo dans l'UI. Vérifier `POST /api/demo/seed` est appelé.
- [ ] Vérifier que le dashboard, `/savings`, `/loans`, `/income` affichent des données démo.
- [ ] Quitter mode démo. Vérifier que les vraies données reviennent.
- [ ] Vérifier que `/api/demo/data DELETE` reset proprement.

```bash
git tag v3-phase8-done
git tag v3-complete
```

---

## Annexes

### Annexe A : commit conventions

Tous les commits utilisent les préfixes : `feat(scope):`, `fix(scope):`, `refactor(scope):`, `test(scope):`, `docs(scope):`. Co-author footer optionnel selon préférence utilisateur.

### Annexe B : récap dépendances entre phases

```
Phase 1 (FR fix) ──── indépendante ─── livrable seule
Phase 2 (Épargne) ──── indépendante ─── livrable seule
Phase 3 (Crédits) ──── indépendante ─── livrable seule
Phase 4 (AutoSync) ─── requiert 2 + 3
Phase 5 (Suggestions) ─ requiert 3 + 4 (et touche 4 pour upsert)
Phase 6 (Renommage) ── préfère après 1-5 (cosmétique)
Phase 7 (Bonus dashboard) ─ requiert 2 + 3 + 4
Phase 8 (Mode démo) ── requiert 2 + 3 + 4 + 5 + 7 (refactor StorageService impacte tout)
```

### Annexe C : recette de sync vers le NAS

Toutes les phases utilisent le même cycle. Adapter selon ce qui a été modifié :

```bash
# Sync sources WSL → NAS
rsync -av --delete backend/src/ nas:/volume2/docker/developpeur/finance-tracker/backend/src/
rsync -av --delete frontend/src/ nas:/volume2/docker/developpeur/finance-tracker/frontend/src/

# Rebuild containers ciblés
ssh nas "cd /volume2/docker/developpeur/finance-tracker && docker compose up -d --build --force-recreate --no-deps finance-backend finance-frontend"

# Logs (en cas de problème)
ssh nas "cd /volume2/docker/developpeur/finance-tracker && docker compose logs --tail=200 finance-backend"
```

> Pour les phases qui n'ajoutent pas de dépendance npm, le rebuild est rapide (~30 s). Si les `package.json` changent, ajouter `--no-cache` au build.

### Annexe D : tests backend — convention

- Tous les tests sont dans le même dossier que le service (`*.spec.ts` côté du `*.service.ts`).
- Utiliser `fs.mkdtempSync(os.tmpdir() + '/ft-X-')` pour isoler les fichiers JSON.
- Mock `EventBusService` pour éviter les SSE.
- Mock `RequestDataDirService` à partir de la Phase 8 (avant : `ConfigService` suffit).
- `npm test` pour lancer la suite, `npm test -- <filter>` pour un fichier précis.
