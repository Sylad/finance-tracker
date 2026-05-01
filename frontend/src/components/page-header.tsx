import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
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
        <h1 className="font-display text-display-md font-bold text-fg-bright tracking-tight">
          {title}
        </h1>
        {subtitle && (
          <div className="text-sm text-fg-muted mt-2 max-w-2xl">{subtitle}</div>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
