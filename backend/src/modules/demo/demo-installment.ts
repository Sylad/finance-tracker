import { InstallmentLine, Loan } from '../../models/loan.model';

export const DEMO_INSTALLMENT_ID = 'demo-loan-alma-4x';

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
