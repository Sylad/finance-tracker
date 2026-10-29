import { useEffect, type ReactNode } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { useDemoStatus } from '@/lib/queries';
import { Sidebar } from './sidebar';
import { BottomNav } from './bottom-nav';
import { TopBar } from './top-bar';
import { CommandPalette } from '../command-palette';
import { InstallPrompt } from '../install-prompt';
import { demoStore } from '@/lib/demo';
import { cn } from '@/lib/utils';
import { pageTitle } from './page-title';

export function AppShell({ children }: { children: ReactNode }) {
  const status = useDemoStatus();
  const forced = status.data?.forced === true;
  const showBanner = forced || demoStore.isActive();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => { document.title = pageTitle(pathname); }, [pathname]);
  return (
    <div className="min-h-screen">
      {/* Lien d'évitement (WCAG 2.4.1) : visible au focus seulement, avant la barre latérale. */}
      <a
        href="#contenu"
        onClick={(e) => { e.preventDefault(); document.getElementById('contenu')?.focus(); }}
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-surface-2 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-fg-bright focus:ring-2 focus:ring-accent"
      >
        Aller au contenu
      </a>
      {showBanner && (
        // Sous l'en-tête fixe du téléphone (h-14) : mt-14, et <main> perd son
        // pt-14 pour ne pas doubler le décalage (L21/t7).
        <div
          data-demo-banner
          role="status"
          className="mt-14 lg:mt-0 lg:ml-[240px] bg-warning/20 border-b border-warning text-warning px-4 sm:px-6 py-2 text-sm font-medium text-center"
        >
          <span className="sm:hidden">🎭 Mode démo {forced && 'verrouillé '}— données fictives.</span>
          <span className="hidden sm:inline">
            🎭 Mode démo {forced && 'verrouillé '}— données fictives. Toutes les fonctionnalités sont actives, rien n'est partagé avec un vrai compte.
          </span>
          {!forced && (
            <button onClick={() => demoStore.disable()} className="underline ml-2 inline-flex min-h-11 items-center px-2">Quitter</button>
          )}
        </div>
      )}
      <Sidebar />
      <BottomNav />
      <TopBar />
      <main id="contenu" tabIndex={-1} className={cn('outline-none lg:pl-[240px] lg:pt-0 pb-20 lg:pb-0', !showBanner && 'pt-14')}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-10">
          {children}
        </div>
      </main>
      <CommandPalette />
      <InstallPrompt />
    </div>
  );
}
