import type { ReactNode } from 'react';
import { Dialog } from '@/components/dialog';

/**
 * Confirmation d'une action destructive, dans la page (remplace `confirm()` natif, que les
 * lecteurs d'écran et les tests ne maîtrisent pas). Le focus entre sur la fenêtre, jamais sur
 * le bouton destructif : Entrée ne confirme pas à la place de l'utilisateur.
 */
export function ConfirmDialog({ title, confirmLabel, onConfirm, onCancel, children }: {
  title: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  return (
    <Dialog title={title} size="max-w-md" onClose={onCancel}>
      {children && <div className="p-5 text-sm text-fg-muted space-y-2">{children}</div>}
      <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
        <button type="button" onClick={onCancel} className="btn-secondary">Annuler</button>
        <button type="button" onClick={onConfirm} className="btn-primary">{confirmLabel}</button>
      </div>
    </Dialog>
  );
}
