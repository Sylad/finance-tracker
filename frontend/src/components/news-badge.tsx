import { cn } from '@/lib/utils';

/**
 * L47 — pastille « nouveau » : nombre d'entrées non vues (chiffre lisible, pas seulement
 * une couleur) et le même nombre en toutes lettres pour lecteur d'écran, qui complète
 * le nom accessible du lien ou du bouton : « Nouveautés (2 nouveautés non vues) ».
 * Émeraude pleine (--accent), texte --bg : contraste vérifié dans contrast.test.ts.
 * 16 px de haut : la ligne qui la porte ne grandit pas (aucun décalage à l'apparition).
 */
export function NewsBadge({
  badge,
  label,
  className,
}: {
  badge: string;
  /** Texte pour lecteur d'écran ; vide si l'appelant le place lui-même (après le libellé). */
  label: string;
  className?: string;
}) {
  if (!badge) return null;
  return (
    <>
      <span
        data-news-badge
        aria-hidden="true"
        className={cn(
          'grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold leading-none tabular-nums text-bg',
          className,
        )}
      >
        {badge}
      </span>
      {label && <span className="sr-only"> ({label})</span>}
    </>
  );
}
