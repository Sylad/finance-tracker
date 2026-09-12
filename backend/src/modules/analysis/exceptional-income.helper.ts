import type { MonthlyStatement } from '../../models/monthly-statement.model';

/** Un salaire au-delà de RATIO × la médiane des salaires précédents est exceptionnel. */
export const EXCEPTIONAL_INCOME_RATIO = 3;
/** Nombre minimal de relevés précédents portant un salaire pour établir une médiane. */
export const MIN_SALARY_HISTORY = 2;

export interface ExceptionalIncomeFlag {
  transactionId: string;
  recurringCreditId: string;
  baseline: number;
  exceptionalAmount: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Médiane du salaire récurrent sur les relevés précédents (le plus gros crédit
 * `salary` de chaque relevé). null si moins de MIN_SALARY_HISTORY relevés.
 */
export function salaryBaseline(previous: MonthlyStatement[]): number | null {
  const perStatement: number[] = [];
  for (const st of previous) {
    const salaries = (st.recurringCredits ?? []).filter((rc) => rc.category === 'salary' && rc.monthlyAmount > 0);
    if (salaries.length === 0) continue;
    perStatement.push(Math.max(...salaries.map((rc) => rc.monthlyAmount)));
  }
  if (perStatement.length < MIN_SALARY_HISTORY) return null;
  return round2(median(perStatement));
}

/**
 * Règle déterministe post-analyse (vécu 2026-08 : solde de tout compte de
 * 37 k€ classé « salaire récurrent » → prévisions à 37 k€/mois, score faussé).
 *
 * Pour chaque crédit récurrent `salary` du relevé dont le montant dépasse
 * EXCEPTIONAL_INCOME_RATIO × la médiane des salaires précédents :
 *  - la transaction correspondante reçoit `exceptionalAmount = amount − médiane`
 *  - le crédit récurrent retombe à `monthlyAmount = médiane`
 * La part « normale » reste un salaire ; l'excédent est hors récurrence.
 *
 * Mute `statement` en place. Idempotent (un crédit déjà ramené à la médiane
 * n'est plus au-dessus du seuil).
 */
export function applyExceptionalIncomeRule(
  statement: MonthlyStatement,
  previous: MonthlyStatement[],
): ExceptionalIncomeFlag[] {
  const baseline = salaryBaseline(previous.filter((s) => s.id !== statement.id));
  if (baseline == null) return [];
  const threshold = baseline * EXCEPTIONAL_INCOME_RATIO;
  const flags: ExceptionalIncomeFlag[] = [];

  for (const rc of statement.recurringCredits ?? []) {
    if (rc.category !== 'salary' || rc.monthlyAmount <= threshold) continue;
    // Transaction porteuse : crédit du même montant (±1 €), sinon le plus gros crédit du relevé.
    const credits = statement.transactions.filter((t) => t.amount > 0 && t.exceptionalAmount == null);
    const matched =
      credits.find((t) => Math.abs(t.amount - rc.monthlyAmount) <= 1) ??
      credits.sort((a, b) => b.amount - a.amount)[0];
    if (!matched) continue;
    const exceptionalAmount = round2(matched.amount - baseline);
    if (exceptionalAmount <= 0) continue;
    matched.exceptionalAmount = exceptionalAmount;
    rc.monthlyAmount = baseline;
    flags.push({ transactionId: matched.id, recurringCreditId: rc.id, baseline, exceptionalAmount });
  }
  return flags;
}
