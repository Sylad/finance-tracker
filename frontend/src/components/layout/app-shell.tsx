import type { ReactNode } from 'react';
import { Sidebar } from './sidebar';
import { BottomNav } from './bottom-nav';
import { TopBar } from './top-bar';
import { demoStore } from '@/lib/demo';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      {demoStore.isActive() && (
        <div className="bg-warning/20 border-b border-warning text-warning px-6 py-2 text-sm font-medium text-center">
          🎭 Mode démo actif — données fictives.
          <button onClick={() => demoStore.disable()} className="underline ml-2">Quitter</button>
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
    </div>
  );
}
