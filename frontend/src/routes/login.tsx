import { useId, useRef, useState } from 'react';
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
  const inputRef = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const errorId = useId();

  const fail = (message: string) => {
    submitting.current = false;
    setBusy(false);
    setPin('');
    setError(message);
    inputRef.current?.focus();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const ok = await verifyPin(pin);
      if (!ok) {
        fail('PIN invalide');
        return;
      }
      authStore.setPin(pin);
      navigate({ to: '/', replace: true });
    } catch {
      fail('Connexion impossible');
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
              <Lock className="h-3 w-3" aria-hidden="true" /> PIN
            </span>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              ref={inputRef}
              value={pin}
              onChange={(e) => {
                setPin(e.target.value);
                setError(null);
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              className={cn(
                'input text-center tracking-[0.4em] text-lg',
                error && 'border-negative focus:border-negative',
              )}
              placeholder="••••"
            />
          </label>

          {error && (
            <div id={errorId} role="alert" className="text-xs text-negative text-center -mt-1">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!pin}
            aria-busy={busy}
            className="btn-primary w-full"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {busy ? 'Déverrouillage…' : 'Déverrouiller'}
          </button>
        </form>

        <div className="text-center text-[10px] uppercase tracking-[0.18em] text-fg-dim mt-6">
          v2.0 · Vibe coded with Claude Code
        </div>
      </div>
    </div>
  );
}
