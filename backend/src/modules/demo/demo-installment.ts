import { InstallmentLine, Loan, LoanOccurrence } from '../../models/loan.model';
import { MonthlyStatement } from '../../models/monthly-statement.model';
import { Transaction } from '../../models/transaction.model';

export const DEMO_INSTALLMENT_ID = 'demo-loan-alma-4x';
const DEMO_INSTALLMENT_OCCURRENCE_ID = 'occ-demo-alma-4x-1';
const DEMO_INSTALLMENT_TX_PREFIX = 'demo-tx-alma-4x-';

const INSTALLMENTS = 4;
const AMOUNT = 62.5;

const pad = (n: number) => String(n).padStart(2, '0');

/** Date `monthsFromNow` mois après `now` (UTC), le jour ramené dans le mois. */
function monthDay(now: Date, monthsFromNow: number): string {
  const idx = now.getUTCFullYear() * 12 + now.getUTCMonth() + monthsFromNow;
  const [y, m] = [Math.floor(idx / 12), idx % 12];
  const day = Math.min(now.getUTCDate(), new Date(Date.UTC(y, m + 1, 0)).getUTCDate());
  return `${y}-${pad(m + 1)}-${pad(day)}`;
}

/**
 * Paiement en 4 fois de la démo (L146) : signé il y a un mois, première
 * échéance payée, la deuxième tombe aujourd’hui. Construit à la date du jour,
 * et non lu dans les fixtures, pour rester « actif » sans retard quelle que
 * soit la date (le recalage des fixtures décale des mois entiers, pas des jours).
 */
export function buildDemoInstallmentLoan(now: Date): Loan {
  const schedule: InstallmentLine[] = Array.from({ length: INSTALLMENTS }, (_, i) => ({
    dueDate: monthDay(now, i - 1),
    amount: AMOUNT,
    paid: i === 0,
  }));
  const signature = schedule[0].dueDate;
  return {
    id: DEMO_INSTALLMENT_ID,
    name: 'ALMA 4X (62,50 €/mois)',
    type: 'classic',
    kind: 'installment',
    category: 'consumer',
    monthlyPayment: AMOUNT,
    matchPattern: 'ALMA',
    isActive: true,
    creditor: 'ALMA',
    contractRef: '',
    startDate: signature,
    endDate: schedule[INSTALLMENTS - 1].dueDate,
    initialPrincipal: AMOUNT * INSTALLMENTS,
    occurrencesDetected: [],
    installmentSchedule: schedule,
    installmentMerchant: 'DARTY',
    installmentSignatureDate: signature,
    createdAt: `${signature}T00:00:00Z`,
    updatedAt: now.toISOString(),
  } as Loan;
}

/**
 * Débit ALMA de l'échéance 1 (L150), tel que le relevé du mois le porte.
 * Sans lui l'échéance est « payée » sans prélèvement : le graphique « Charge
 * crédits » n'a rien ce mois-là.
 */
function debitTransaction(statementId: string, line: InstallmentLine): Transaction {
  return {
    id: `${DEMO_INSTALLMENT_TX_PREFIX}${statementId}`,
    date: line.dueDate,
    description: 'PRELEVT ALMA 4X DARTY',
    normalizedDescription: 'prelevt alma 4x darty',
    amount: -line.amount,
    currency: 'EUR',
    category: 'transfers',
    subcategory: 'loan',
    isRecurring: false,
    confidence: 1,
  };
}

/**
 * Pose (ou replace, à la date du jour) le débit ALMA dans son relevé. Les
 * totaux ne bougent qu'à la première pose : un débit déjà présent est
 * remplacé, pas ajouté.
 */
export function upsertDemoInstallmentDebit(statement: MonthlyStatement, occurrence: LoanOccurrence): MonthlyStatement {
  const tx = debitTransaction(statement.id, { dueDate: occurrence.date, amount: -occurrence.amount, paid: true });
  const present = statement.transactions.some((t) => t.id === tx.id);
  const transactions = present
    ? statement.transactions.map((t) => (t.id === tx.id ? tx : t))
    : [...statement.transactions, tx];
  if (present) return { ...statement, transactions };
  const cents = (n: number) => Math.round(n * 100) / 100;
  return {
    ...statement,
    transactions,
    totalDebits: cents(statement.totalDebits - tx.amount),
    closingBalance: cents(statement.closingBalance + tx.amount),
  };
}

/**
 * Relie l'échéance 1 payée à son prélèvement : une occurrence sur le crédit
 * et le débit dans le relevé du mois de l'échéance. Sans relevé de ce mois
 * (démo hors de toute plage), rien n'est payé : l'échéance reste à venir.
 */
export function attachDemoInstallmentDebit(
  statements: MonthlyStatement[],
  loan: Loan,
): { statements: MonthlyStatement[]; loan: Loan } {
  const first = loan.installmentSchedule![0];
  const statementId = first.dueDate.slice(0, 7);
  if (!statements.some((s) => s.id === statementId)) {
    const schedule = loan.installmentSchedule!.map((l, i) => (i === 0 ? { ...l, paid: false } : l));
    return { statements, loan: { ...loan, installmentSchedule: schedule } };
  }
  const occurrence: LoanOccurrence = {
    id: DEMO_INSTALLMENT_OCCURRENCE_ID,
    statementId,
    date: first.dueDate,
    amount: -first.amount,
    transactionId: `${DEMO_INSTALLMENT_TX_PREFIX}${statementId}`,
    description: 'PRELEVT ALMA 4X DARTY',
    source: 'bank_statement',
  };
  return {
    statements: statements.map((s) => (s.id === statementId ? upsertDemoInstallmentDebit(s, occurrence) : s)),
    loan: {
      ...loan,
      occurrencesDetected: [occurrence],
      installmentSchedule: loan.installmentSchedule!.map((l, i) => (i === 0 ? { ...l, paidOccurrenceId: occurrence.id } : l)),
    },
  };
}
