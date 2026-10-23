import { useEffect, useRef } from 'react';

const FOCUSABLES = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

/**
 * Comportement clavier d'une fenêtre modale : focus sur le champ `initialFocusRef` à
 * l'ouverture et rendu au bouton d'origine à la fermeture ; Échap ferme ; Tab / Maj+Tab
 * bouclent dans la fenêtre. Une touche dont la cible est une couche posée par-dessus
 * (palette ⌘K) lui appartient : la fenêtre l'ignore.
 */
export function useModalDialog(onCancel: () => void) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const initialFocusRef = useRef<HTMLInputElement>(null);
  // Gardé à jour sans relancer l'effet : onCancel change à chaque rendu du parent.
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    // Sans champ désigné : premier champ de saisie, sinon la fenêtre elle-même (tabIndex -1),
    // jamais une action (supprimer, fusionner) que Entrée déclencherait aussitôt.
    const dialog = dialogRef.current;
    (initialFocusRef.current ?? dialog?.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled])') ?? dialog)?.focus();
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as Node | null;
      const inModal = !target || target === document.body || !!dialogRef.current?.contains(target);
      if (!inModal) return;
      if (e.key === 'Escape') {
        onCancelRef.current();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLES);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      // Focus hors de la fenêtre (body après un clic sur une zone inerte) : on y rentre.
      // La fenêtre elle-même (focus d'ouverture sans champ) compte comme avant le premier élément.
      if (!dialogRef.current.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return { dialogRef, initialFocusRef };
}
