import { Link } from '@tanstack/react-router';
import { Sparkles } from 'lucide-react';
import type { HealthDiagnostic } from '@/types/api';
import { cn } from '@/lib/utils';

const DOT_COLOR: Record<HealthDiagnostic['verdict'], string> = {
  green: 'bg-positive',
  orange: 'bg-warning',
  red: 'bg-negative',
};

/**
 * Tuile dashboard « Santé financière » — même gabarit `card p-5` que
 * StatCard, mais cliquable (Link vers /health) avec une pastille couleur
 * verdict + une phrase courte (1re cause si non-vert, sinon confirmation).
 */
export function HealthTile({ diagnostic }: { diagnostic: HealthDiagnostic | undefined }) {
  if (!diagnostic) return null;

  if (diagnostic.reliability === 'unavailable') {
    return (
      <Link to="/health" className="card p-5 card-hover block">
        <div className="stat-label flex items-center gap-1.5">
          <Sparkles className="h-3 w-3" /> Santé financière
        </div>
        <div className="flex items-center gap-2 mt-3">
          <span className="h-2.5 w-2.5 rounded-full bg-fg-dim shrink-0" />
          <span className="text-sm font-medium text-fg-muted">Santé : à configurer</span>
        </div>
      </Link>
    );
  }

  const phrase = diagnostic.verdict === 'green' ? 'Situation saine' : (diagnostic.causes[0] ?? 'À surveiller');

  return (
    <Link to="/health" className="card p-5 card-hover block">
      <div className="stat-label flex items-center gap-1.5">
        <Sparkles className="h-3 w-3" /> Santé financière
      </div>
      <div className="flex items-center gap-2 mt-3">
        <span className={cn('h-2.5 w-2.5 rounded-full shrink-0', DOT_COLOR[diagnostic.verdict])} />
        <span className="text-sm font-medium text-fg-bright">{phrase}</span>
      </div>
    </Link>
  );
}
