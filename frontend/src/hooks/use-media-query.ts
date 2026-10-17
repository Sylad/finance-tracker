import { useEffect, useState } from 'react';

/** Largeur de `lg` (Tailwind par défaut : le projet ne redéfinit que `2xl`). */
export const LG_QUERY = '(min-width: 1024px)';

function matches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false;
}

/**
 * Suit une media query CSS. Sans `matchMedia` (rendu serveur, jsdom) : false,
 * c'est-à-dire la mise en page étroite.
 */
export function useMediaQuery(query: string): boolean {
  const [value, setValue] = useState(() => matches(query));
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = () => setValue(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return value;
}
