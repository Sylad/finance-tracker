import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Loader2, Lock } from 'lucide-react';
import { authStore } from '@/lib/auth';
import { verifyPin } from '@/lib/api';
import { BrandMark } from '@/components/brand-mark';
import { cn } from '@/lib/utils';

export function LoginPage() {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin || busy) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await verifyPin(pin);
      if (!ok) {
        setError('PIN invalide');
        setBusy(false);
        return;
      }
      authStore.setPin(pin);
      navigate({ to: '/', replace: true });
    } catch {
      setError('Connexion impossible');
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-8">
          <BrandMark className="h-16 w-16 mb-5" />
          <h1 className="font-display text-2xl font-bold text-fg-bright tracking-tight">
            Finance Tracker
          </h1>
          <p className="text-sm text-fg-muted mt-1.5">
            Saisis ton PIN pour accéder à tes données
          </p>
        </div>

        <form onSubmit={submit} className="card p-6 space-y-4">
          <label className="block">
            <span className="stat-label flex items-center gap-1.5 mb-2">
              <Lock className="h-3 w-3" /> PIN
            </span>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className={cn('input text-center tracking-[0.4em] text-lg', error && 'border-negative')}
              placeholder="••••"
            />
          </label>

          {error && (
            <div className="text-xs text-negative text-center -mt-1">{error}</div>
          )}

          <button
            type="submit"
            disabled={!pin || busy}
            className="btn-primary w-full"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Déverrouiller'}
          </button>
        </form>

        <div className="text-center text-[10px] uppercase tracking-[0.18em] text-fg-dim mt-6">
          v2.0 · Vibe coded with Claude Code
        </div>
      </div>
    </div>
  );
}
