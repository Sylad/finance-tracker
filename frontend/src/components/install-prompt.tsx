import { useEffect, useState } from 'react';
import { Smartphone, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'ft_install_dismissed_at';
const DISMISS_TTL_DAYS = 14;

/**
 * Minimal PWA install prompt — appears as a small fixed banner at the
 * bottom of the screen on supported browsers (Chrome/Edge, Safari iOS via
 * its own "Add to home screen" UI which we don't trigger here). Users can
 * dismiss it and we won't bug them again for 14 days.
 */
export function InstallPrompt() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);
      const ttl = DISMISS_TTL_DAYS * 86400 * 1000;
      if (dismissedAt && Date.now() - dismissedAt < ttl) return;
      setEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => setEvt(null));
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (!evt) return null;

  const onDismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setEvt(null);
  };

  const onInstall = async () => {
    await evt.prompt();
    const choice = await evt.userChoice;
    if (choice.outcome === 'dismissed') localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setEvt(null);
  };

  return (
    <div className="fixed bottom-4 right-4 z-40 max-w-sm card p-4 shadow-xl flex items-start gap-3">
      <Smartphone className="h-5 w-5 text-accent-bright shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-fg-bright text-sm">Installer Finance Tracker</div>
        <div className="text-xs text-fg-muted mt-0.5">
          Ajoute l'app à ton téléphone ou ton bureau pour un accès en un clic.
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={onInstall} className="btn-primary text-xs">Installer</button>
          <button onClick={onDismiss} className="btn-ghost text-xs">Plus tard</button>
        </div>
      </div>
      <button onClick={onDismiss} className="text-fg-muted hover:text-fg shrink-0" aria-label="Fermer">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
