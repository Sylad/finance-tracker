# Step 02: Plan

**Task:** Modéliser pay-in-N comme `kind='installment'` avec `installmentSchedule[]` précis
**Started:** 2026-05-10T12:36:47Z

## Strategy : 2 commits cohérents

**Commit A — Backend modélisation + matcher** : model + Claude tool + ImportOrchestrator + matcher syncLoans + tests.
**Commit B — Frontend UI + doc** : InstallmentCard + section + tracker + suspicious modal action + CLAUDE.md.

## Files Changes

### Commit A — Backend

#### 1. `backend/src/models/loan.model.ts`
```typescript
export type LoanKind = 'classic' | 'revolving' | 'installment';
export interface InstallmentLine {
  dueDate: string;             // YYYY-MM-DD
  amount: number;              // montant exact attendu
  paid: boolean;               // marqué true par syncLoans quand match
  paidOccurrenceId?: string;   // id de l'occurrence qui a satisfait cette ligne
}
interface Loan {
  ... existant
  kind?: LoanKind;             // optionnel pour rétro-compat ; déduit si absent
  installmentSchedule?: InstallmentLine[];  // pour kind='installment'
  // Métadonnées du contrat installment
  installmentMerchant?: string;     // 'AMAZON'
  installmentSignatureDate?: string;// '2025-11-01'
}
```

Migration douce : helper `getLoanKind(loan)` qui retourne `loan.kind ?? (loan.type === 'classic' ? 'classic' : 'revolving')` pour tout legacy code.

#### 2. `backend/src/modules/analysis/credit-statement.schemas.ts`
Ajouter `InstallmentDetailsSchema`, `installmentDetails: z.nullable().optional()` au principal schéma.

```typescript
const InstallmentDetailsSchema = z.object({
  count: z.number().int().min(2).max(12),
  amount: z.number().positive(),  // montant uniforme (si variable, voir installments)
  installments: z.array(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    amount: z.number().positive(),
  })).min(2),
  merchant: z.string().nullable().optional(),
  signatureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  totalAmount: z.number().positive(),
  fees: z.number().nonnegative().nullable().optional(),
});
```

#### 3. `backend/src/modules/analysis/credit-statement.service.ts`
- Tool schema enrichi avec `installmentDetails` (object|null)
- System prompt mis à jour :
  > Si le PDF contient **"Contrat de paiement en NXCB"** ou "N FOIS" ou "PAY LATER" comme titre/type explicite, c'est un PAIEMENT ÉCHELONNÉ COURT, distinct d'un crédit revolving classique. Dans ce cas, remplir `installmentDetails` avec :
  > - `count` = N (4 pour 4XCB, 3 pour 3X)
  > - `installments` = liste des N dates calculées depuis "1 jour après envoi", "32 jours après", etc. + montant exact
  > - `merchant` = nom du commerçant (ex: AMAZON)
  > - `signatureDate` = "Contrat accepté le ..." si visible
  > - `totalAmount` = montant total à rembourser
  > - `fees` = frais si distincts du total
  > Si `installmentDetails != null`, **mettre `creditType: 'classic'`** (pas revolving), `currentBalance: totalAmount` (avant prélèvement), `monthlyPayment: amount`.
  > Sinon → `installmentDetails: null` et le PDF est un relevé classique.
- `CreditStatementAnalysis` type retourne `installmentDetails`

#### 4. `backend/src/modules/loans/import-orchestrator.service.ts`
- Dans `importCreditStatement(extracted)` : si `extracted.installmentDetails`, branche dédiée :
  - `findOrCreate(signals, defaults)` avec `signals.creditor + monthlyAmount` (les pay-in-4 n'ont pas de contractRef stable)
  - Si crée nouveau : `kind='installment'`, `name="{merchant} · {N}× {creditor} · {totalAmount}€"`, `installmentSchedule = installments.map(i => ({dueDate: i.date, amount: i.amount, paid: false}))`, `installmentMerchant`, `installmentSignatureDate`, `endDate = lastDueDate`
  - Si match existant : mise à jour du `installmentSchedule` (idempotent)
  - SKIP `applyStatementSnapshot` (pas pertinent pour un contrat one-shot, c'est pas un relevé mensuel)

#### 5. `backend/src/modules/auto-sync/auto-sync.service.ts`
- Dans `syncLoans(statement)` :
  - Pour chaque loan, si `kind === 'installment'` et `installmentSchedule?.length > 0` :
    - Pour chaque ligne `installmentSchedule[i]` non payée et avec dueDate ≤ statement.dateMax :
      - Cherche dans statement.transactions une tx avec :
        - `Math.abs(date - dueDate) ≤ 3 jours`
        - `Math.abs(amount + amount_attendu) ≤ 0.50€`  // amount négatif côté bank
        - description match creditor (case-insensitive substring)
      - Si match : `addOccurrence` (source 'bank_statement') + `loan.installmentSchedule[i].paid = true` + `paidOccurrenceId = newOcc.id` + persist
  - Sinon (kind classic/revolving) : matcher actuel inchangé

#### 6. `backend/src/modules/loans/loans.service.ts`
- Helper static `getLoanKind(loan: Loan): LoanKind` : retourne kind explicite ou déduit
- `mergeLoanPatch` accepte `installmentSchedule` patch (amortization-only, ou user pour conversions)

#### 7. Tests Jest (≥10)
- `loans.service.spec.ts` : getLoanKind retourne explicit puis fallback type
- `loans.service.spec.ts` : Loan classic créé sans `kind` → migration retourne 'classic' implicite
- `import-orchestrator.service.spec.ts` (nouveau) : import contrat 4XCB → crée Loan kind='installment' avec schedule[4]
- `import-orchestrator.service.spec.ts` : import même contrat 2x → no duplicate (findExistingLoan match)
- `auto-sync.service.spec.ts` : tx bank matche dueDate ±3j + amount ±0.50€ → marque `paid=true` + addOccurrence
- `auto-sync.service.spec.ts` : tx bank ne matche aucune dueDate → reste paid=false
- `auto-sync.service.spec.ts` : 2ème run du même statement (idempotent) ne re-match pas (paid déjà true)
- `loans.service.spec.ts` : getSuspiciousLoans skip les `kind='installment'` (légitimes)
- `loans.service.spec.ts` : getLoanHealth 'complete' si toutes past dueDates paid
- `auto-sync.service.spec.ts` : matcher classic/revolving inchangé pour les loans non-installment

### Commit B — Frontend + doc

#### 8. `frontend/src/types/api.ts`
- `LoanKind`, `InstallmentLine`, `Loan.kind?`, `Loan.installmentSchedule?`, `Loan.installmentMerchant?`, `Loan.installmentSignatureDate?` ajoutés (miroir backend).

#### 9. `frontend/src/components/loans/installment-card.tsx` (nouveau)
- Card distincte de classic/revolving avec :
  - Header : merchant + creditor + count×amount
  - Mini-tracker visuel : suite de pastilles (•••• vert si paid, ◯◯◯◯ gris sinon, • orange en retard si dueDate < today et !paid)
  - Liste détaillée des dueDates avec status
  - HealthChip
  - Bouton trash + edit (pour user override)

#### 10. `frontend/src/routes/loans.tsx`
- `installments = items.filter(l => l.kind === 'installment' && l.isActive)` (séparé de classics/revolvings)
- Section "Paiements échelonnés actifs" entre classics et revolvings.

#### 11. `frontend/src/components/loans/suspicious-modal.tsx`
- Pour chaque loan suspect, ajouter bouton "Convertir en paiement échelonné" (qui PUT le loan avec `kind='installment'`). User crée manuellement le schedule après si besoin (V2 — pour V1 c'est juste un changement de kind).
- Bouton "Supprimer" reste (cas où vraiment à supprimer).

#### 12. `frontend/src/components/loans/health-chip.tsx`
- Si `loan.kind === 'installment'` : utiliser un calcul spécifique :
  - `complete` si toutes les past dueDates sont paid
  - `partial` si certaines past dueDates non paid (en retard)
  - `gap` si pas de schedule du tout

Backend `getLoanHealth` aussi mis à jour pour ce cas.

#### 13. `finance-tracker/CLAUDE.md`
Section "Synchro robuste 3-sources" enrichie :
- Le concept `kind` (classic / revolving / installment)
- Le matching exact pour installment (vs fuzzy pour classic/revolving)
- Le tool Claude qui détecte le contrat 4XCB

## Order

Commit A (backend) → tests verts → Commit B (frontend + doc) → tests verts → deploy NAS.

## Risks / Mitigations

- **Risk** : Claude confond contrat 4XCB et relevé revolving mensuel → System prompt très explicite avec exemples : "Si tu vois 'Contrat de paiement en 4XCB' c'est un installment".
- **Risk** : matcher installment précis (±3j ±0.50€) ne match pas si la banque a un retard de 4j → Tolérance 3j peut-être étendue à 5j si problème en prod.
- **Risk** : conversion suspect→installment doit reset des champs revolving (maxAmount, usedAmount) → Backend endpoint dédié `/api/loans/:id/convert-to-installment`. Pour V1, simple `update` user OK.

→ Proceeding to execute phase…
