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
  LogOut,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { BrandMark } from '../brand-mark';
import { authStore } from '@/lib/auth';

export const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/history', label: 'Historique', icon: History, exact: false },
  { to: '/budget', label: 'Budget', icon: Wallet, exact: false },
  { to: '/recurring', label: 'Crédits récurrents', icon: Repeat, exact: false },
  { to: '/declarations', label: 'Déclarations', icon: ListChecks, exact: false },
  { to: '/forecast', label: 'Prévisions', icon: CalendarRange, exact: false },
  { to: '/yearly', label: 'Bilan annuel', icon: CalendarDays, exact: false },
  { to: '/upload', label: 'Importer', icon: Upload, exact: false },
] as const;

export function Sidebar() {
  const { location } = useRouterState();
  const path = location.pathname;

  const handleLogout = () => {
    authStore.logout();
    window.location.href = '/login';
  };

  return (
    <aside className="hidden lg:flex fixed inset-y-0 left-0 w-[240px] flex-col bg-surface border-r border-border z-40">
      <div className="px-5 pt-6 pb-7">
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

      <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
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

        <div className="my-3 mx-3 h-px bg-border" />

        <Link
          to="/about"
          className={cn(
            'group relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors',
            path.startsWith('/about')
              ? 'bg-surface-2 text-fg-bright'
              : 'text-fg-muted hover:bg-surface-2/60 hover:text-fg',
          )}
        >
          {path.startsWith('/about') && (
            <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-sm bg-accent" />
          )}
          <Info className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
          <span className="font-medium">À propos</span>
        </Link>
      </nav>

      <div className="px-3 pb-3 border-t border-border pt-3 space-y-1">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-fg-muted hover:bg-surface-2/60 hover:text-fg transition-colors"
        >
          <LogOut className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
          <span className="font-medium">Déconnexion</span>
        </button>
      </div>

      <div className="px-6 py-3 border-t border-border">
        <div className="text-[10px] uppercase tracking-[0.14em] text-fg-dim">v2.0</div>
      </div>
    </aside>
  );
}
