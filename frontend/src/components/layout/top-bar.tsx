import { Link } from '@tanstack/react-router';
import { Drama } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { BrandMark } from '../brand-mark';
import { demoStore } from '@/lib/demo';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

export function TopBar() {
  const demoStatus = useQuery({
    queryKey: ['demo', 'status'],
    queryFn: () => api.get<{ available: boolean; seeded: boolean }>('/demo/status'),
    retry: false,
    staleTime: 60_000,
  });
  const demoOn = demoStore.isActive();

  const handleToggle = async () => {
    if (demoOn) {
      demoStore.disable();
    } else {
      if (!demoStatus.data?.seeded) {
        try {
          await api.post('/demo/seed');
        } catch (e) {
          console.error('Demo seed failed', e);
        }
      }
      demoStore.enable();
    }
  };

  return (
    <header className="lg:hidden fixed top-0 inset-x-0 z-40 h-14 bg-surface/95 backdrop-blur-md border-b border-border flex items-center justify-between px-4">
      <Link to="/" className="flex items-center gap-2.5">
        <BrandMark className="h-8 w-8" />
        <div className="font-display text-sm font-bold tracking-tight text-fg-bright">
          Finance Tracker
        </div>
      </Link>
      {demoStatus.data?.available && (
        <button
          onClick={handleToggle}
          className={cn(
            'btn-ghost flex items-center gap-1.5 text-sm',
            demoOn && 'text-warning',
          )}
          title={demoOn ? 'Quitter le mode démo' : 'Activer le mode démo (données fictives)'}
        >
          <Drama className="h-4 w-4" />
          {demoOn ? 'Quitter démo' : 'Mode démo'}
        </button>
      )}
    </header>
  );
}
