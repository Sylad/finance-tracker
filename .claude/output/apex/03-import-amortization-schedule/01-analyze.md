# Step 01: Analyze

**Task:** Import tableau amortissement crédit classique (PDF) — pré-remplissage Loan + suivi capital restant dû
**Started:** 2026-05-10T11:24:51Z

## Codebase Context (capitalisé sur sessions RUM + dedupe précédentes)

### Pattern de référence à reproduire

**`backend/src/modules/analysis/credit-statement.service.ts`** (déjà éprouvé — modèle direct) :
- Singleton NestJS `@Injectable()` avec `Anthropic` client + `ClaudeUsageService`
- `claude-sonnet-4-5`, `tool_choice: { type: 'tool', name: 'extract_credit_statement' }` strict
- PDF ingéré via `{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf } }`
- Stream finalization → `tool_use` block → Zod validation via `parseExternal()` (zod-validation.pipe)
- Erreurs : `CreditStatementParseError`, `isAuthError`/`isQuotaError` mapped to `HttpException`
- Schémas Zod dans `credit-statement.schemas.ts` avec `.superRefine()`

### Loan model (`backend/src/models/loan.model.ts`)

`Loan` actuel a déjà : `startDate`, `endDate`, `initialPrincipal` (classic), `lastStatementSnapshot`. Manque :
**`amortizationSchedule?: Array<{ date, capitalRemaining, capitalPaid, interestPaid }>`** (optionnel, rétrocompat).

### Service Loans

Méthodes utiles : `getAll/getOne/create/update`, `applyStatementSnapshot(id, extracted)` (modèle pour update partiel + persist + bus event), persistance via `data/loans.json` + `bus.emit('loans-changed')`.

### Controller Loans — pattern upload existant

```typescript
@Post('import-credit-statements')
@UseInterceptors(FilesInterceptor('files', 12, { storage: memoryStorage(), fileFilter, limits }))
```

→ Adapter en `@Post('import-amortization')` avec `@UploadedFile()` (PDF unique) + query `attachToLoanId?`.

### Frontend (`frontend/src/`)

- `routes/loans.tsx` — bouton "Relevés crédit (PDF)" via `useRef + <input type="file" hidden>` + handler upload + modal `importResult`. Pattern à dupliquer.
- `components/loans/import-statement-modal.tsx` — upload PDF dédié à un loan existant
- `lib/queries.ts` — hooks TanStack mutation + invalidate `qkLoans.all()`
- `types/api.ts` — `Loan` TS type miroir backend
- Recharts déjà bundled (`dist/assets/recharts-...js`) — déjà utilisé pour `loans-monthly-chart`

### PinGuard + démo bypass

`isDemoMode()` → 403 (pattern auto-categorize). Endpoint sensible.

## Constraints

- ❌ Pas écriture directe dans `data/loans.json` — `LoansService.persist()`
- ❌ Two-phase Claude : phase 1 > 0 lignes avant phase 2
- ❌ Pas de fixture avec vraies infos crédit (data/ gitignored)
- ✅ PinGuard + bypass démo 403
- ✅ `claude-sonnet-4-5`
- ✅ Schémas Zod miroir

## Inferred Acceptance Criteria

- [ ] AC1: `Loan.amortizationSchedule?` ajouté au modèle backend + frontend type
- [ ] AC2: `AmortizationService.analyzeAmortization(pdfBuffer)` via Claude tool `extract_amortization_schedule` retourne `{ creditor, initialPrincipal, monthlyPayment, startDate, endDate, taeg, schedule[≥1] }`
- [ ] AC3: `POST /api/loans/import-amortization` (PinGuard + bypass démo 403) crée un nouveau Loan classic OU update existant via query `?attachToLoanId=<id>`
- [ ] AC4: Frontend bouton "Importer tableau d'amortissement (PDF)" sur `/loans`, modal résultat
- [ ] AC5: Visualisation Recharts capital prévu vs réel sur la card classique du loan
- [ ] AC6: ≥5 specs Jest backend (extraction, démo 403, Zod fail, attach existing, schedule vide → erreur)
- [ ] AC7: Builds verts + 126/126 tests backend non-régressés
- [ ] AC8: Commit Co-Authored-By + push origin/main + deploy NAS

## Stats

- Files analyzed: 8
- Patterns identified: 4 (Claude tool_use two-phase, NestJS PDF upload + Zod, frontend modal upload, Recharts line chart)
- Utilities found: 5 (parseExternal, isAuthError/isQuotaError, ClaudeUsageService, RequestDataDirService.isDemoMode, EventBusService)

→ Proceeding to planning phase…
