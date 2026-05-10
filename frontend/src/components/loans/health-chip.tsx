import type { Loan } from '@/types/api';

const LABELS: Record<NonNullable<Loan['health']>, { emoji: string; label: string; tone: string; tooltip: string }> = {
  complete: {
    emoji: '🟢',
    label: 'Complet',
    tone: 'text-positive bg-positive/10 border-positive/30',
    tooltip: 'Tableau d\'amortissement OU statement récent + au moins 3 occurrences sur les 6 derniers mois.',
  },
  partial: {
    emoji: '🟡',
    label: 'Partiel',
    tone: 'text-warning bg-warning/10 border-warning/30',
    tooltip: 'Une partie des données manque (statement vieux, peu d\'occurrences, ou pas de tableau d\'amortissement).',
  },
  gap: {
    emoji: '🔴',
    label: 'Trou',
    tone: 'text-negative bg-negative/10 border-negative/30',
    tooltip: 'Très peu de données. Importer un relevé crédit ou tableau d\'amortissement aiderait.',
  },
};

interface Props {
  loan: Loan;
}

export function HealthChip({ loan }: Props) {
  if (!loan.health) return null;
  const cfg = LABELS[loan.health];
  return (
    <span
      title={cfg.tooltip}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-mono uppercase tracking-wider ${cfg.tone}`}
    >
      <span aria-hidden>{cfg.emoji}</span>
      <span>{cfg.label}</span>
    </span>
  );
}
