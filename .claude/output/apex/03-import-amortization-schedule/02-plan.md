# Step 02: Plan

**Task:** Import tableau amortissement crédit classique (PDF) — pré-remplissage Loan + suivi capital restant dû
**Started:** 2026-05-10T11:24:51Z

## Overview

Reproduire le pattern `credit-statement.service` (Claude `tool_use` strict + Zod validation + PDF base64) pour ingérer un tableau d'amortissement initial. Endpoint `POST /api/loans/import-amortization` (PinGuard + bypass démo) qui crée un Loan classic pré-rempli OU update existant via `?attachToLoanId=`. Frontend bouton + modal résultat + mini-graph capital prévu vs réel.

## File Changes (par fichier, ordonné par dépendance)

### Backend

#### 1. `backend/src/models/loan.model.ts` (modifier)
Ajouter :
```typescript
export interface AmortizationLine {
  date: string;            // YYYY-MM-DD
  capitalRemaining: number; // capital restant dû en fin de période
  capitalPaid: number;      // capital amorti dans la période
  interestPaid: number;     // intérêts payés dans la période
}
```
Et dans `Loan` (entre `lastStatementSnapshot?` et `createdAt`) :
```typescript
amortizationSchedule?: AmortizationLine[];
```
Optionnel, rétrocompat OK.

#### 2. `backend/src/modules/analysis/amortization.schemas.ts` (créer)
```typescript
import { z } from 'zod';

export const AmortizationLineSchema = z.object({
  date: z.string(),
  capitalRemaining: z.number().nonnegative(),
  capitalPaid: z.number().nonnegative(),
  interestPaid: z.number().nonnegative(),
});

export const AmortizationOutputSchema = z.object({
  creditor: z.string(),
  initialPrincipal: z.number().positive(),
  monthlyPayment: z.number().positive(),
  startDate: z.string(),
  endDate: z.string(),
  taeg: z.number().nullable().optional(),
  schedule: z.array(AmortizationLineSchema).min(1, 'schedule must contain at least one line'),
});

export type AmortizationOutput = z.infer<typeof AmortizationOutputSchema>;
```

#### 3. `backend/src/modules/analysis/amortization.service.ts` (créer)
Copier le pattern de `credit-statement.service.ts`. Tool `extract_amortization_schedule` Claude :
- input_schema strict : creditor, initialPrincipal, monthlyPayment, startDate, endDate, taeg, schedule[].
- system prompt orienté "tableaux d'amortissement français (auto, conso, immo)" — préciser format date, capital qui doit décroître, schedule peut faire 12-360 lignes.
- max_tokens 16384 (tableaux longs immo)
- Stream finalization → tool_use → Zod parse
- `AmortizationParseError`, `isAuthError`/`isQuotaError` (réutilise common helpers)

#### 4. `backend/src/modules/analysis/analysis.module.ts` (modifier)
Ajouter `AmortizationService` aux providers + exports.

#### 5. `backend/src/modules/loans/loans.controller.ts` (modifier)
Ajouter endpoint :
```typescript
@Post('import-amortization')
@UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), fileFilter: pdfOnly, limits: 20MB }))
async importAmortization(
  @UploadedFile() file: Express.Multer.File | undefined,
  @Query('attachToLoanId') attachToLoanId?: string,
) {
  if (this.dataDir.isDemoMode()) throw new ForbiddenException('Démo : import désactivé');
  const extracted = await this.amortization.analyzeAmortization(file.buffer);
  if (attachToLoanId) {
    return this.svc.applyAmortizationSchedule(attachToLoanId, extracted);
  } else {
    // create new Loan classic pré-rempli
    const loan = await this.svc.create({ ... mappings ... });
    return this.svc.applyAmortizationSchedule(loan.id, extracted);
  }
}
```
Inject `AmortizationService` + `RequestDataDirService`.

#### 6. `backend/src/modules/loans/loans.service.ts` (ajouter méthode)
```typescript
async applyAmortizationSchedule(id: string, extracted: AmortizationOutput): Promise<Loan> {
  // update partiel : initialPrincipal, monthlyPayment, startDate, endDate, taeg.
  // assign schedule[]
  // updatedAt + persist + bus.emit
}
```

#### 7. `backend/src/modules/loans/dto/loan.dto.ts` (modifier)
Ajouter validation pour `amortizationSchedule?` array (typage permissif via `validateLoanInput` ou exclude — ce champ n'est pas saisi via le formulaire, juste via l'import. **Décision : exclude du DTO write — il ne doit pas être éditable manuellement**, seul l'import le populates).

#### 8. `backend/src/modules/loans/loans.module.ts` (modifier)
Importer `AnalysisModule` (déjà importé pour `CreditStatementService`) — vérifier que `AmortizationService` est bien exporté.

#### 9. `backend/src/modules/loans/loans.service.spec.ts` (ajouter tests)
≥3 specs sur `applyAmortizationSchedule` :
- update Loan existant : update partiel champs + schedule assigné
- schedule rejeté si vide (laissé au schema → backend trust extracted)
- schedule sort chrono même si Claude renvoie désordonné

#### 10. `backend/src/modules/loans/loans.controller.spec.ts` (créer ou ajouter)
≥3 specs e2e light avec service mocké :
- demo mode → 403
- attachToLoanId présent → applyAmortizationSchedule appelé
- attachToLoanId absent → create + apply

### Frontend

#### 11. `frontend/src/types/api.ts` (modifier)
Ajouter `AmortizationLine` + `Loan.amortizationSchedule?: AmortizationLine[]`.

#### 12. `frontend/src/lib/queries.ts` (ajouter hook)
```typescript
export interface AmortizationImportResult { /* identique au backend retour */ }

export function useImportAmortization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, attachToLoanId }: { file: File; attachToLoanId?: string }) => {
      const form = new FormData(); form.append('file', file);
      const url = attachToLoanId
        ? `/loans/import-amortization?attachToLoanId=${encodeURIComponent(attachToLoanId)}`
        : '/loans/import-amortization';
      return api.postForm<Loan>(url, form);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qkLoans.all() }),
  });
}
```

#### 13. `frontend/src/routes/loans.tsx` (modifier)
Ajouter bouton "Tableau d'amortissement (PDF)" à côté du "Relevés crédit". Réutilise pattern `useRef + <input hidden>`. Modal résultat : afficher `Loan` créé/mis à jour + premiers/derniers points du schedule.

#### 14. `frontend/src/components/loans/amortization-chart.tsx` (créer)
Recharts LineChart minimal :
- Axe X = date (mois)
- Axe Y = capital
- Line "Prévu" : `amortizationSchedule.map(l => l.capitalRemaining)`
- Line "Réel" (estimé) : initialPrincipal moins cumul des `occurrencesDetected.amount` à date donnée
- Palette finance (slate + emerald), tooltip euro, responsive container

Affiché sur `ClassicCard` quand `loan.amortizationSchedule?.length > 0`.

#### 15. `frontend/src/components/loans/classic-card.tsx` (modifier)
Si `loan.amortizationSchedule?.length > 0` → afficher le `<AmortizationChart loan={loan} />` (collapsed par défaut, toggle).

## Dependency order

1-2 (model + schema) → 3 (service) → 4 (module) → 5 (controller) → 6 (service method) → 7 (DTO) → 8 (loans module) → 9-10 (tests) → 11 (frontend types) → 12 (hook) → 13 (page) → 14 (chart) → 15 (card).

## Risks

- **Tableaux immo très longs** (300+ lignes) : `max_tokens` 16384 devrait suffire pour 360 mois × ~50 chars JSON. À monitor.
- **Format date hétérogène** : système prompt strict "YYYY-MM-DD".
- **Rétrocompat schedule = []** : Zod `.min(1)` rejette → propage erreur user-visible.
- **Recharts dataset taille** : 360 points ResponsiveContainer OK mais à tester.

## Mapping AC → Files

| AC | Files |
|---|---|
| AC1 model + frontend type | 1, 11 |
| AC2 Claude tool extract | 2, 3 |
| AC3 endpoint | 4, 5, 6, 8 |
| AC4 frontend bouton + modal | 12, 13 |
| AC5 visualisation Recharts | 14, 15 |
| AC6 ≥5 specs | 9, 10 |
| AC7 builds verts | (validation step 04) |
| AC8 commit + push + deploy | (validation step 04) |

→ Proceeding to execute phase…
