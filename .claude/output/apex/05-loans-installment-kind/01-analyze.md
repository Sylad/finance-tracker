# Step 01: Analyze

**Task:** Modéliser pay-in-N comme `kind='installment'` avec `installmentSchedule[]` précis
**Started:** 2026-05-10T12:36:47Z

## Audit existant (capitalisé sur APEX 04 + observation user du PDF Cofidis 4XCB)

### Ce que le PDF Cofidis 4XCB contient (échantillon vérifié)

```
Cofidis - Contrat de paiement en 4XCB
Chez : AMAZON
Total à payer : 263,24 €
Frais : 5,91 €

Mon échéancier :
1ère mensualité : 65,81 €  Prélevée 1 jour après l'envoi de la commande
2ème mensualité : 65,81 €  Prélevée 32 jours après
3ème mensualité : 65,81 €  Prélevée 63 jours après
4ème mensualité : 65,81 €  Prélevée 90 jours après

Contrat accepté par voie électronique le 01/11/2025.
```

→ Toutes les infos pour un pay-in-N sont là : type explicite, marchand, créancier, count, amount, dates relatives, signature date, total. **Le tool Claude actuel `extract_credit_statement` les ignore.**

### Ce qu'on a aujourd'hui (post-APEX 04)

**Loan model** (`backend/src/models/loan.model.ts`):
```typescript
type LoanType = 'classic' | 'revolving';
interface Loan {
  type: LoanType;
  monthlyPayment, matchPattern, ...
  amortizationSchedule?: AmortizationLine[];  // pour classic
  ...
}
```

**Pay-in-N est traité comme** :
- `type='revolving'` (Claude voit Cofidis + currentBalance variant) OU
- `type='classic'` ad-hoc (créé via auto-suggestion bank statement)

Dans les 2 cas : pas d'échéancier précis, juste `monthlyPayment` plat.

**Garde-fous existants** (mais non-modélisation du concept) :
- `auto-sync.PAY_IN_N_PATTERN` (loans-patterns.ts) regex qui filtre à la création préventive
- `LoansService.getSuspiciousLoans()` détection rétrospective
- `MIN_OCCURRENCES_AUTO_CREATE = 5` seuil min

→ Tous périmètres de protection. Aucun ne sait représenter "ce loan EST un pay-in-4 et son échéancier = ces 4 dates".

### Tool Claude `extract_credit_statement` actuel

`backend/src/modules/analysis/credit-statement.service.ts` (lignes 29-89) :
```typescript
EXTRACT_CREDIT_STATEMENT_TOOL = {
  input_schema: {
    properties: {
      creditor, creditType ('revolving' | 'classic'),
      currentBalance, maxAmount, monthlyPayment,
      endDate, taeg, statementDate, startDate?,
      accountNumber, rumNumber,
    },
  },
};
```

→ Aucun champ `installmentDetails`. Claude voit "Contrat 4XCB" et collapse en `creditType=revolving`.

### Pipeline de matching bank → loan actuel

`auto-sync.syncLoans()` matche les transactions bank par :
1. OR-set (contractRef + rumRefs[]) dans description
2. AND regex matchPattern

Pas d'utilisation de l'échéancier. Pour un pay-in-4 modèle nouveau, on pourrait matcher exactement par (date attendue ±3j, amount ±0.50€, creditor pattern) — beaucoup plus précis.

### ImportOrchestratorService (APEX 04 item 4)

Aujourd'hui : `importCreditStatement(extracted)` → `findOrCreate` puis `applyStatementSnapshot`. Le flow assume statement mensuel.

→ Doit apprendre : si `installmentDetails != null`, créer un Loan `kind='installment'` avec `installmentSchedule[]` et SKIP `applyStatementSnapshot` (pas pertinent pour un contrat one-shot).

## Acceptance Criteria

- [ ] AC1 : `Loan.kind: 'classic' | 'revolving' | 'installment'` ajouté. Migration douce : loans existants → `kind` déduit du `type`. `installmentSchedule?: Array<{ dueDate, amount, paid: boolean, paidOccurrenceId? }>` ajouté.
- [ ] AC2 : Tool Claude `extract_credit_statement` enrichi avec `installmentDetails: {...} | null`. System prompt apprend à distinguer "Contrat 4XCB" vs relevé revolving mensuel.
- [ ] AC3 : `ImportOrchestratorService.importCreditStatement` détecte `installmentDetails`, crée Loan `kind='installment'` avec schedule calculé depuis `signatureDate + delta jours`.
- [ ] AC4 : `auto-sync.syncLoans` apprend matcher spécialisé pour `kind='installment'` : pour chaque dueDate non payée, cherche tx (date ±3j, amount ±0.50€, creditor pattern). Mark `paid=true` si match.
- [ ] AC5 : Frontend section "Paiements échelonnés actifs" + `<InstallmentCard />` avec mini-tracker (ex: ✓✓◯◯ pour 2/4 paid). HealthChip `complete` si toutes les past dueDates sont paid.
- [ ] AC6 : `SuspiciousModal` propose action "Convertir en paiement échelonné" en plus de "Supprimer".
- [ ] AC7 : Doc CLAUDE.md mise à jour.
- [ ] AC8 : ≥10 nouveaux tests verts. 168 + 10 = 178+ total.
- [ ] AC9 : Commit(s) + push + deploy NAS.

## Stats

- Files analyzed : 6 (loan.model, credit-statement.service+schemas, auto-sync.service, import-orchestrator, suspicious-modal)
- Strong points existants à réutiliser : findExistingLoan (matcher), mergeLoanPatch (priorité source), PAY_IN_N_PATTERN regex
- Risques connus : Claude peut confondre "1ère mensualité 65.81€" d'un contrat 4XCB avec une mensualité de revolving — le system prompt doit être très clair sur "titre du PDF contient 4XCB / 3X / N FOIS → c'est un installment"

→ Proceeding to planning phase…
