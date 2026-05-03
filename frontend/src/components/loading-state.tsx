import { Loader2 } from 'lucide-react';

export function LoadingState({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 text-fg-muted py-24">
      <Loader2 className="h-10 w-10 animate-spin text-accent-bright" />
      <span className="text-sm font-medium">{label}</span>
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
