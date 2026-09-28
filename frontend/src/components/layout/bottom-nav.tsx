import { useEffect, useRef, useState } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { cn } from '@/lib/utils';
import { LayoutDashboard, History, Wallet, Upload, Menu, X, LogOut } from 'lucide-react';
import { authStore } from '@/lib/auth';
import { NAV_ITEMS, SECONDARY_ITEMS } from './sidebar';

// 4 destinations directes + « Plus » (L21/t8) : les 18 pages restent
// atteignables au téléphone. Prévisions passe dans « Plus ».
const MOBILE_ITEMS = [
  { to: '/' as const, label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/history' as const, label: 'Historique', icon: History, exact: false },
  { to: '/budget' as const, label: 'Budget', icon: Wallet, exact: false },
  { to: '/upload' as const, label: 'Importer', icon: Upload, exact: false },
];

const ALL_PAGES = [...NAV_ITEMS, ...SECONDARY_ITEMS];

export function BottomNav() {
  const { location } = useRouterState();
  const path = location.pathname;
  const [open, setOpen] = useState(false);
  const firstLink = useRef<HTMLAnchorElement>(null);
  const plusButton = useRef<HTMLButtonElement>(null);

  // Fermeture à la navigation, à Échap ; focus sur la 1re page à l'ouverture.
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    if (!open) return;
    firstLink.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        plusButton.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const tabClass = (active: boolean) => cn(
    'flex flex-col items-center justify-center gap-1 py-2.5 transition-colors',
    active ? 'text-accent-bright' : 'text-fg-muted',
  );
  const plusActive = open || !MOBILE_ITEMS.some((i) => (i.exact ? path === i.to : path.startsWith(i.to)));

  return (
    <>
      {open && (
        <div className="lg:hidden fixed inset-0 z-40" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-bg/70 backdrop-blur-sm" aria-hidden="true" />
          <div
            id="all-pages-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="all-pages-title"
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-lg border-t border-border bg-surface px-4 pt-4"
            style={{ paddingBottom: 'calc(4.5rem + env(safe-area-inset-bottom))' }}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 id="all-pages-title" className="stat-label">Toutes les pages</h2>
              <button type="button" onClick={() => setOpen(false)} className="btn-ghost h-11 w-11 p-0" aria-label="Fermer">
                <X className="h-5 w-5" />
              </button>
            </div>
            <ul className="grid grid-cols-2 gap-1">
              {ALL_PAGES.map((item, i) => {
                const Icon = item.icon;
                const active = item.to === '/' ? path === '/' : path.startsWith(item.to);
                return (
                  <li key={item.to}>
                    <Link
                      ref={i === 0 ? firstLink : undefined}
                      to={item.to}
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
              <Link key={item.to} to={item.to} className={tabClass(active)}>
                <Icon className="h-[20px] w-[20px]" strokeWidth={active ? 2.25 : 1.75} />
                <span className="text-[10px] font-medium tracking-wide">{item.label}</span>
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
            <Menu className="h-[20px] w-[20px]" strokeWidth={plusActive ? 2.25 : 1.75} />
            <span className="text-[10px] font-medium tracking-wide">Plus</span>
          </button>
        </div>
      </nav>
    </>
  );
}
