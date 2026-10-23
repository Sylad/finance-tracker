import { useId, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useModalDialog } from '@/hooks/use-modal-dialog';

/**
 * Fenêtre modale commune : voile qui défile (le panneau part du haut, jamais centré, pour que
 * titre et actions restent atteignables sur petit écran), role=dialog nommé par son titre,
 * focus au premier champ, Tab bouclé, Échap et clic sur le voile ferment, focus rendu à
 * l'ouverture. Le contenu (formulaire, listes) vient en enfants, sous l'en-tête.
 */
export function Dialog({ title, description, size = 'max-w-lg', onClose, children }: {
  title: ReactNode;
  description?: ReactNode;
  size?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const { dialogRef } = useModalDialog(onClose);
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto animate-fade-in" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-desc` : undefined}
        tabIndex={-1}
        className={`card ${size} w-full my-8 outline-none`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <h2 id={`${id}-title`} className="font-display font-semibold text-fg-bright flex items-center gap-2">{title}</h2>
            {description && <p id={`${id}-desc`} className="text-xs text-fg-muted">{description}</p>}
          </div>
          <button type="button" onClick={onClose} className="btn-ghost p-1" aria-label="Fermer" title="Fermer"><X className="h-4 w-4" aria-hidden="true" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
