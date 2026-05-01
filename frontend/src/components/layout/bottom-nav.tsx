import { Link, useRouterState } from '@tanstack/react-router';
import { cn } from '@/lib/utils';
import { LayoutDashboard, History, Wallet, CalendarRange, Upload } from 'lucide-react';

const MOBILE_ITEMS = [
  { to: '/' as const, label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/history' as const, label: 'Historique', icon: History, exact: false },
  { to: '/budget' as const, label: 'Budget', icon: Wallet, exact: false },
  { to: '/forecast' as const, label: 'Prévisions', icon: CalendarRange, exact: false },
  { to: '/upload' as const, label: 'Importer', icon: Upload, exact: false },
];

export function BottomNav() {
  const { location } = useRouterState();
  const path = location.pathname;

  return (
    <nav
      className="lg:hidden fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur-md"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="grid grid-cols-5">
        {MOBILE_ITEMS.map((item) => {
          const active = item.exact ? path === item.to : path.startsWith(item.to);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                'flex flex-col items-center justify-center gap-1 py-2.5 transition-colors',
                active ? 'text-accent-bright' : 'text-fg-muted',
              )}
            >
              <Icon className="h-[20px] w-[20px]" strokeWidth={active ? 2.25 : 1.75} />
              <span className="text-[10px] font-medium tracking-wide">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
