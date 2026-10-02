import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import {
  LayoutDashboard,
  History,
  Wallet,
  Repeat,
  ListChecks,
  CalendarRange,
  CalendarDays,
  Upload,
  Info,
  Megaphone,
  ListTodo,
  LogOut,
  PiggyBank,
  Banknote,
  Zap,
  Tags,
  Target,
  Grid3x3,
  HeartPulse,
  Receipt,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { BrandMark } from '../brand-mark';
import { authStore } from '@/lib/auth';
import { NewsBadge } from '../news-badge';
import { useNewsBadge } from '@/hooks/use-news-badge';

export const NAV_ITEMS = [
  { to: '/', label: 'Tableau de bord', icon: LayoutDashboard, exact: true },
  { to: '/health', label: 'Santé', icon: HeartPulse, exact: false },
  { to: '/expenses', label: 'Dépenses', icon: Receipt, exact: false },
  { to: '/history', label: 'Historique', icon: History, exact: false },
  { to: '/budget', label: 'Budget', icon: Wallet, exact: false },
  { to: '/savings', label: 'Comptes épargne', icon: PiggyBank, exact: false },
  { to: '/loans', label: 'Crédits', icon: Banknote, exact: false },
  { to: '/subscriptions', label: 'Abonnements', icon: Zap, exact: false },
  { to: '/income', label: 'Revenus', icon: Repeat, exact: false },
  { to: '/declarations', label: 'Déclarations', icon: ListChecks, exact: false },
  { to: '/forecast', label: 'Prévisions', icon: CalendarRange, exact: false },
  { to: '/yearly', label: 'Bilan annuel', icon: CalendarDays, exact: false },
  { to: '/heatmap', label: 'Heatmap', icon: Grid3x3, exact: false },
  { to: '/goals', label: 'Objectifs', icon: Target, exact: false },
  { to: '/category-rules', label: 'Catégorisation', icon: Tags, exact: false },
  { to: '/upload', label: 'Importer', icon: Upload, exact: false },
] as const;

export const SECONDARY_ITEMS = [
  { to: '/nouveautes', label: 'Nouveautés', icon: Megaphone },
  { to: '/plan', label: 'Plan de travail', icon: ListTodo },
  { to: '/about', label: 'À propos', icon: Info },
] as const;

export function Sidebar() {
  const { location } = useRouterState();
  const path = location.pathname;
  const news = useNewsBadge();

  // Revue UX L50 : fondu en bas de la liste des pages tant qu'elle peut encore défiler
  // (repère « il y a d'autres pages »), jamais une fois au bout ni quand tout tient.
  const scroller = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const measure = useCallback(() => {
    const el = scroller.current;
    if (el) setMore(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
  }, []);
  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (ro && scroller.current) {
      ro.observe(scroller.current);
      if (scroller.current.firstElementChild) ro.observe(scroller.current.firstElementChild);
    }
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, [measure]);

  const handleLogout = () => {
    authStore.logout();
    window.location.href = '/login';
  };

  return (
    <aside className="hidden lg:flex fixed inset-y-0 left-0 w-[240px] flex-col bg-surface border-r border-border z-40">
      <div className="shrink-0 px-5 pt-6 pb-7">
        <Link to="/" className="flex items-center gap-3 group">
          <BrandMark className="h-11 w-11 transition-transform group-hover:scale-105" />
          <div className="min-w-0">
            <div className="font-display text-base font-bold tracking-tight text-fg-bright leading-none">
              Finance Tracker
            </div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-fg-dim mt-1.5 font-semibold">
              Vibe coded
            </div>
          </div>
        </Link>
      </div>

      {/* Zone qui défile : les pages, puis la recherche rapide et la version (revue UX
          L50 : sortis du pied fixe, qui faisait 213 px + 32 px — 8 pages sur 16 visibles
          à 1280×720). */}
      <div className="relative flex-1 min-h-0">
        <div ref={scroller} data-sidebar-scroll onScroll={measure} className="h-full overflow-y-auto px-3 pb-2">
          <nav aria-label="Pages" className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const active = item.exact ? path === item.to : path.startsWith(item.to);
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    'group relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors',
                    active
                      ? 'bg-surface-2 text-fg-bright'
                      : 'text-fg-muted hover:bg-surface-2/60 hover:text-fg',
                  )}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-sm bg-accent" />
                  )}
                  <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
                  <span className={cn('font-medium', active && 'text-fg-bright')}>
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </nav>
          <div className="mx-3 mt-3 mb-2 h-px bg-border" />
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('finance:open-command-palette'))}
            className="w-full px-3 py-1 text-[10px] uppercase tracking-[0.14em] text-fg-dim flex items-center justify-between rounded-md hover:bg-surface-2/60 hover:text-fg transition-colors cursor-pointer"
            title="Ouvrir la recherche rapide (⌘K / Ctrl+K)"
          >
            <span>Recherche rapide</span>
            <kbd className="font-sans normal-case text-[10px] tracking-normal border border-border rounded px-1.5 py-[1px] text-fg-muted">⌘K</kbd>
          </button>
          <div className="px-3 pt-2 text-[10px] uppercase tracking-[0.14em] text-fg-dim">v2.0</div>
        </div>
        <div
          data-testid="sidebar-scroll-fade"
          data-visible={more ? 'true' : 'false'}
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-surface to-transparent transition-opacity',
            more ? 'opacity-100' : 'opacity-0',
          )}
        />
      </div>

      {/* L50 : pied FIXE (ne défile pas) — Nouveautés (et sa pastille), Plan de travail
          et À propos restent visibles au bureau quelle que soit la hauteur de l'écran ;
          c'est la liste des pages au-dessus qui défile. Lignes compactes (36 px) : la
          pastille de 16 px ne change pas leur hauteur. Seuls ces trois liens et
          Déconnexion y restent (revue UX L50). */}
      <div data-sidebar-footer className="shrink-0 px-3 py-2 border-t border-border space-y-0.5">
        <nav aria-label="Application" className="space-y-0.5">
          {SECONDARY_ITEMS.map(({ to, label, icon: Icon }) => {
            const active = path.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  'group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                  active
                    ? 'bg-surface-2 text-fg-bright'
                    : 'text-fg-muted hover:bg-surface-2/60 hover:text-fg',
                )}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-sm bg-accent" />
                )}
                <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
                <span className="font-medium">{label}</span>
                {to === '/nouveautes' && (
                  <NewsBadge badge={news.badge} label={news.label} className="ml-auto shrink-0" />
                )}
              </Link>
            );
          })}
        </nav>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm text-fg-muted hover:bg-surface-2/60 hover:text-fg transition-colors"
        >
          <LogOut className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
          <span className="font-medium">Déconnexion</span>
        </button>
      </div>
    </aside>
  );
}
