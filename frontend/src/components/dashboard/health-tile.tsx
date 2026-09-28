import { Link } from '@tanstack/react-router';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import type { HealthDiagnostic } from '@/types/api';
import { cn } from '@/lib/utils';
import { attentionPoints, type AttentionStatus } from './attention-points';

const DOT: Record<AttentionStatus | 'green', string> = {
  green: 'bg-positive',
  orange: 'bg-warning',
  red: 'bg-negative',
};
const STATUS_WORD: Record<AttentionStatus, string> = {
  red: 'Alerte',
  orange: 'Vigilance',
};
const MAX_POINTS = 3;

/**
 * Tuile « Points d'attention » (L21/t6, ex-« Santé financière » en double
 * avec l'anneau du score). Une ligne par règle non verte, en français
 * lisible, pastille de la couleur de CETTE règle + mot d'état pour ne pas
 * dépendre de la couleur seule (WCAG 1.4.1). Lien vers /health.
 */
export function HealthTile({ diagnostic, className }: { diagnostic: HealthDiagnostic | undefined; className?: string }) {
  if (!diagnostic) return null;

  const header = (
    <div className="flex items-center justify-between gap-2">
      <div className="stat-label flex items-center gap-1.5">
        <AlertTriangle className="h-3 w-3" /> Points d'attention
      </div>
      <ArrowRight className="h-3.5 w-3.5 text-fg-dim" aria-hidden="true" />
    </div>
  );

  if (diagnostic.reliability === 'unavailable') {
    return (
      <Link to="/health" className={cn('card p-5 card-hover block', className)}>
        {header}
        <div className="flex items-center gap-2 mt-3">
          <span className="h-2.5 w-2.5 rounded-full bg-fg-dim shrink-0" />
          <span className="text-sm font-medium text-fg-muted">Diagnostic à configurer (revenus)</span>
        </div>
      </Link>
    );
  }

  const points = attentionPoints(diagnostic);
  const shown = points.slice(0, MAX_POINTS);

  return (
    <Link to="/health" className={cn('card p-5 card-hover block', className)}>
      {header}
      {points.length === 0 ? (
        <div className="flex items-center gap-2 mt-3">
          <span className={cn('h-2.5 w-2.5 rounded-full shrink-0', DOT.green)} />
          <span className="text-sm font-medium text-fg-bright">Aucun point d'attention</span>
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {shown.map((p, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className={cn('mt-1.5 h-2.5 w-2.5 rounded-full shrink-0', DOT[p.status])} aria-hidden="true" />
              <span className="text-fg-bright">
                <span className={cn('font-semibold', p.status === 'red' ? 'text-negative' : 'text-warning')}>
                  {STATUS_WORD[p.status]}
                </span>
                {' · '}
                {p.text}
              </span>
            </li>
          ))}
          {points.length > MAX_POINTS && (
            <li className="text-xs text-fg-muted">+ {points.length - MAX_POINTS} autre(s) sur la page Santé</li>
          )}
        </ul>
      )}
    </Link>
  );
}
