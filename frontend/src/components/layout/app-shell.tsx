import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sidebar } from './sidebar';
import { BottomNav } from './bottom-nav';
import { TopBar } from './top-bar';
import { CommandPalette } from '../command-palette';
import { InstallPrompt } from '../install-prompt';
import { demoStore } from '@/lib/demo';
import { api } from '@/lib/api';

export function AppShell({ children }: { children: ReactNode }) {
  const status = useQuery({
    queryKey: ['demo', 'status'],
    queryFn: () => api.get<{ available: boolean; seeded: boolean; forced: boolean }>('/demo/status'),
    retry: false,
    staleTime: 60_000,
  });
  const forced = status.data?.forced === true;
  const showBanner = forced || demoStore.isActive();
  return (
    <div className="min-h-screen">
      {showBanner && (
        <div className="bg-warning/20 border-b border-warning text-warning px-6 py-2 text-sm font-medium text-center">
          🎭 Mode démo {forced && 'verrouillé '}— données fictives. Toutes les fonctionnalités sont actives, rien n'est partagé avec un vrai compte.
          {!forced && (
            <button onClick={() => demoStore.disable()} className="underline ml-2">Quitter</button>
          )}
        </div>
      )}
      <Sidebar />
      <BottomNav />
      <TopBar />
      <main className="lg:pl-[240px] pt-14 lg:pt-0 pb-20 lg:pb-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-10">
          {children}
        </div>
      </main>
      <CommandPalette />
      <InstallPrompt />
    </div>
  );
}
