import { useEffect, useRef, useState } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { cn } from '@/lib/utils';
import { LayoutDashboard, History, Wallet, Upload, Menu, X, LogOut } from 'lucide-react';
import { authStore } from '@/lib/auth';
import { NAV_ITEMS, SECONDARY_ITEMS } from './sidebar';
import { NewsBadge } from '../news-badge';
import { useNewsBadge } from '@/hooks/use-news-badge';

// 4 destinations directes + « Plus » (L21/t8) : les 19 pages restent
// atteignables au téléphone. Prévisions passe dans « Plus ».
const MOBILE_ITEMS = [
  // « Tableau de bord » passe sur 2 lignes dans une cellule de 78 px (390)
  // ou 64 px (320), mesuré : libellé visible « Tableau », nom accessible
  // complet (WCAG 2.5.3 : le nom contient le texte visible). L21/t11.
  { to: '/' as const, label: 'Tableau de bord', short: 'Tableau', icon: LayoutDashboard, exact: true },
  { to: '/history' as const, label: 'Historique', icon: History, exact: false },
  { to: '/budget' as const, label: 'Budget', icon: Wallet, exact: false },
  { to: '/upload' as const, label: 'Importer', icon: Upload, exact: false },
];

// L50 (décision de revue UX) : dans le panneau « Plus », les pages principales D'ABORD
// (le focus s'ouvre sur la première), Déconnexion en fin de grille ; Nouveautés, Plan de
// travail et À propos dans une BANDE COLLANTE en bas du panneau, juste au-dessus de la
// barre du bas — miroir du pied fixe du bureau, visible sans défiler à 320×568.

export function BottomNav() {
  const { location } = useRouterState();
  const path = location.pathname;
  const [open, setOpen] = useState(false);
  const news = useNewsBadge();
  const firstLink = useRef<HTMLAnchorElement>(null);
  const plusButton = useRef<HTMLButtonElement>(null);

  const wasOpen = useRef(false);

  // Fermeture à la navigation ; focus sur la 1re page à l'ouverture ; à
  // TOUTE fermeture (Échap, Fermer, voile, choix d'une page) le focus
  // revient au bouton « Plus » (relecture L21).
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      firstLink.current?.focus();
    } else if (wasOpen.current) {
      wasOpen.current = false;
      plusButton.current?.focus();
    }
  }, [open]);

  // Piège à focus (aria-modal) : Tab / Maj+Tab bouclent dans le panneau.
  const onSheetKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const tabClass = (active: boolean) => cn(
    'flex flex-col items-center justify-center gap-1 py-2.5 transition-colors',
    active ? 'text-accent-bright' : 'text-fg-muted',
  );
  const plusActive = open || !MOBILE_ITEMS.some((i) => (i.exact ? path === i.to : path.startsWith(i.to)));

  return (
    <>
      {open && (
        // z-[45] : au-dessus de l'en-tête téléphone (z-40), sous la barre du bas (z-50).
        <div data-testid="all-pages-overlay" className="lg:hidden fixed inset-0 z-[45]">
          <div
            data-testid="all-pages-backdrop"
            className="absolute inset-0 bg-bg/70 backdrop-blur-sm"
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />
          <div
            id="all-pages-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="all-pages-title"
            onKeyDown={onSheetKeyDown}
            className="absolute inset-x-0 bottom-0 max-h-[80vh] flex flex-col rounded-t-lg border-t border-border bg-surface"
            // La barre du bas (z-50, 60 px mesurés) recouvre le bas du panneau : la bande se pose juste au-dessus.
            style={{ paddingBottom: 'calc(3.75rem + env(safe-area-inset-bottom))' }}
          >
            <div data-sheet-scroll className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-2">
              <div className="flex items-center justify-between mb-3">
                <h2 id="all-pages-title" className="stat-label">Toutes les pages</h2>
                <button type="button" onClick={() => setOpen(false)} className="btn-ghost h-11 w-11 p-0" aria-label="Fermer">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <ul aria-label="Pages" className="grid grid-cols-2 gap-1">
                {NAV_ITEMS.map((item, i) => {
                  const Icon = item.icon;
                  const active = item.exact ? path === item.to : path.startsWith(item.to);
                  return (
                    <li key={item.to}>
                      <Link
                        ref={i === 0 ? firstLink : undefined}
                        to={item.to}
                        activeOptions={{ exact: item.exact }}
                        onClick={() => setOpen(false)}
                        className={cn(
                          'flex items-center gap-2.5 rounded-md px-3 min-h-11 text-sm transition-colors',
                          active ? 'bg-surface-2 text-fg-bright' : 'text-fg-muted hover:bg-surface-2/60 hover:text-fg',
                        )}
                      >
                        <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
                        <span className="font-medium">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                onClick={() => { authStore.logout(); window.location.href = '/login'; }}
                className="mt-2 w-full flex items-center gap-2.5 rounded-md px-3 min-h-11 text-sm text-fg-muted hover:bg-surface-2/60 hover:text-fg"
              >
                <LogOut className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
                <span className="font-medium">Déconnexion</span>
              </button>
            </div>
            <div data-sheet-band className="shrink-0 border-t border-border bg-surface">
              <ul aria-label="Application" className="grid grid-cols-3">
                {SECONDARY_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = path.startsWith(item.to);
                  const isNews = item.to === '/nouveautes';
                  return (
                    <li key={item.to}>
                      <Link
                        to={item.to}
                        onClick={() => setOpen(false)}
                        className={cn(
                          'flex flex-col items-center justify-center gap-1 min-h-11 w-full py-2 transition-colors',
                          active ? 'text-accent-bright' : 'text-fg-muted hover:text-fg',
                        )}
                      >
                        {/* Pastille posée sur le coin de l'icône, comme sur « Plus » (L47). */}
                        <span className="relative">
                          <Icon className="h-[20px] w-[20px]" strokeWidth={active ? 2.25 : 1.75} aria-hidden />
                          {isNews && (
                            <NewsBadge badge={news.badge} label="" className="absolute -right-2.5 -top-2 ring-2 ring-surface" />
                          )}
                        </span>
                        <span className="text-[12px] font-medium leading-tight">{item.label}</span>
                        {isNews && news.badge && <span className="sr-only"> ({news.label})</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      )}
      <nav
        aria-label="Navigation principale"
        className="lg:hidden fixed inset-x-0 bottom-0 z-50 border-t border-border bg-surface/95 backdrop-blur-md"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="grid grid-cols-5">
          {MOBILE_ITEMS.map((item) => {
            const active = !open && (item.exact ? path === item.to : path.startsWith(item.to));
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={tabClass(active)}
                aria-label={'short' in item ? item.label : undefined}
              >
                <Icon className="h-[20px] w-[20px]" strokeWidth={active ? 2.25 : 1.75} />
                <span className="text-[10px] font-medium tracking-wide">{'short' in item ? item.short : item.label}</span>
              </Link>
            );
          })}
          <button
            ref={plusButton}
            type="button"
            aria-expanded={open}
            aria-controls="all-pages-sheet"
            onClick={() => setOpen((o) => !o)}
            className={tabClass(plusActive)}
          >
            {/* Pastille posée sur le coin de l'icône : la case garde sa taille (L47). */}
            <span className="relative">
              <Menu className="h-[20px] w-[20px]" strokeWidth={plusActive ? 2.25 : 1.75} aria-hidden />
              {!open && (
                <NewsBadge badge={news.badge} label="" className="absolute -right-2.5 -top-2 ring-2 ring-surface" />
              )}
            </span>
            <span className="text-[10px] font-medium tracking-wide">Plus</span>
            {!open && news.badge && <span className="sr-only"> ({news.label})</span>}
          </button>
        </div>
      </nav>
    </>
  );
}
