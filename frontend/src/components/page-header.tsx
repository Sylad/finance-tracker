import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * En-tête de page. Le h1 nomme TOUJOURS la page (WCAG 2.4.6, L171) : un montant n'est
 * jamais un titre. Une page dont le chiffre clé est le premier repère (Revenus, Crédits…)
 * le passe en `figure` : le nom de la page vient en h1 au-dessus, le chiffre garde la
 * taille d'affichage juste en dessous, en paragraphe.
 */
export function PageHeader({
  eyebrow,
  title,
  figure,
  subtitle,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  figure?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-8', className)}>
      <div>
        {eyebrow && (
          <div className="stat-label text-accent-bright mb-2">{eyebrow}</div>
        )}
        {figure !== undefined ? (
          <>
            <h1 className="font-display text-lg font-semibold text-fg-bright tracking-tight mb-1">{title}</h1>
            <p data-testid="page-key-figure" className="font-display text-display-md font-bold text-fg-bright tracking-tight tabular-nums">
              {figure}
            </p>
          </>
        ) : (
          <h1 className="font-display text-display-md font-bold text-fg-bright tracking-tight">
            {title}
          </h1>
        )}
        {subtitle && (
          <div className="text-sm text-fg-muted mt-2 max-w-2xl">{subtitle}</div>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
