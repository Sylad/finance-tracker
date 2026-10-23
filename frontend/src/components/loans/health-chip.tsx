import { useId, useState } from 'react';
import type { Loan } from '@/types/api';
import { formatDate } from '@/lib/utils';

type Health = NonNullable<Loan['health']>;

const LABELS: Record<Health, { emoji: string; label: string; tone: string }> = {
  complete: { emoji: '🟢', label: 'Complet', tone: 'text-positive bg-positive/10 border-positive/30' },
  partial: { emoji: '🟡', label: 'Partiel', tone: 'text-warning bg-warning/10 border-warning/30' },
  gap: { emoji: '🔴', label: 'Trou', tone: 'text-negative bg-negative/10 border-negative/30' },
};

const DAY_MS = 24 * 3600 * 1000;

interface Criterion {
  ok: boolean;
  /** Phrase complète, sans préfixe « Manque » / « Tenu ». */
  text: string;
}

interface Diagnosis {
  criteria: Criterion[];
  action: string;
}

/**
 * Critères derrière la puce, miroir de `LoansService.getLoanHealth` (backend) :
 * classic/revolving = données (tableau d'amortissement OU relevé crédit de
 * moins de 60 j) + au moins 3 prélèvements sur 180 j ; installment = chaque
 * échéance échue retrouvée dans un relevé bancaire.
 */
function diagnose(loan: Loan, today: string): Diagnosis {
  const kind = loan.kind ?? loan.type;
  if (kind === 'installment') {
    const schedule = loan.installmentSchedule ?? [];
    if (schedule.length === 0) {
      return {
        criteria: [{ ok: false, text: 'l\'échéancier du paiement en plusieurs fois' }],
        action: 'Importez le contrat de paiement en plusieurs fois pour reconstituer l\'échéancier.',
      };
    }
    const past = schedule.filter((l) => l.dueDate <= today);
    const missing = past.filter((l) => !l.paid).length;
    return {
      criteria: [{
        ok: missing === 0,
        text: `${missing} échéance${missing > 1 ? 's' : ''} échue${missing > 1 ? 's' : ''} sur ${past.length} non retrouvée${missing > 1 ? 's' : ''} dans les relevés bancaires`,
      }],
      action: 'Importez le relevé bancaire des mois concernés : les échéances payées seront cochées.',
    };
  }

  const todayMs = new Date(`${today}T00:00:00Z`).getTime();
  const snapshot = loan.lastStatementSnapshot;
  const snapshotDate = snapshot?.extractedValues?.statementDate || snapshot?.date || null;
  const recentSnapshot = snapshotDate ? todayMs - new Date(snapshotDate).getTime() <= 60 * DAY_MS : false;
  const hasAmortization = (loan.amortizationSchedule?.length ?? 0) > 0;
  const sinceMs = todayMs - 180 * DAY_MS;
  const since = new Date(sinceMs).toISOString().slice(0, 10);
  const occurrences = (loan.occurrencesDetected ?? []).filter((o) => o.date >= since && o.date <= today).length;

  const criteria: Criterion[] = [];
  if (hasAmortization) {
    criteria.push({ ok: true, text: 'un tableau d\'amortissement' });
  } else if (recentSnapshot) {
    criteria.push({ ok: true, text: 'un relevé crédit de moins de 60 jours' });
  } else {
    const detail = snapshotDate ? ` (le dernier relevé crédit date du ${formatDate(snapshotDate)})` : '';
    criteria.push({
      ok: false,
      text: `un tableau d'amortissement ou un relevé crédit de moins de 60 jours${detail}`,
    });
  }
  criteria.push({
    ok: occurrences >= 3,
    text: `au moins 3 prélèvements sur 6 mois (${occurrences} trouvé${occurrences > 1 ? 's' : ''})`,
  });

  const actions: string[] = [];
  if (!criteria[0].ok) actions.push('Importez un relevé crédit ou le tableau d\'amortissement.');
  if (!criteria[1].ok) actions.push('Importez les relevés bancaires des derniers mois.');
  return { criteria, action: actions.join(' ') };
}

interface Props {
  loan: Loan;
  /** Jour de référence AAAA-MM-JJ (tests) ; aujourd'hui par défaut. */
  now?: string;
}

export function HealthChip({ loan, now }: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (!loan.health) return null;
  const cfg = LABELS[loan.health];
  const base = `inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-mono uppercase tracking-wider ${cfg.tone}`;

  if (loan.health === 'complete') {
    return (
      <span className={base}>
        <span aria-hidden>{cfg.emoji}</span>
        <span>{cfg.label}</span>
      </span>
    );
  }

  const { criteria, action } = diagnose(loan, now ?? new Date().toISOString().slice(0, 10));
  return (
    <span className="inline-flex flex-col items-start gap-1 align-top">
      <button
        type="button"
        className={`${base} cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden>{cfg.emoji}</span>
        <span>{cfg.label}</span>
        <span aria-hidden>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <span id={panelId} className="block max-w-xs text-xs font-normal normal-case font-sans tracking-normal text-fg-muted space-y-1">
          {criteria.map((c) => (
            <span key={c.text} className="block">
              {c.ok ? 'Tenu' : 'Manque'} : {c.text}
            </span>
          ))}
          {action && <span className="block text-fg-dim">{action}</span>}
        </span>
      )}
    </span>
  );
}
