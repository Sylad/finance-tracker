import { Loader2 } from 'lucide-react';

export function LoadingState({ label = 'Chargement...' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 text-fg-muted py-16">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="card p-8 text-center">
      <div className="text-fg-muted text-sm font-medium">{title}</div>
      {hint && <div className="text-fg-dim text-xs mt-1.5">{hint}</div>}
    </div>
  );
}

export function ErrorState({ message }: { message?: string }) {
  return (
    <div className="card border-negative/30 p-6 text-center">
      <div className="text-negative text-sm font-medium">Erreur</div>
      {message && <div className="text-fg-muted text-xs mt-1.5">{message}</div>}
    </div>
  );
}
