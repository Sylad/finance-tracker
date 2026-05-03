import { Outlet, useRouterState, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { authStore } from '@/lib/auth';
import { AppShell } from './app-shell';
import { LoadingState } from '@/components/loading-state';

export function Root() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const isLogin = pathname.startsWith('/login');
  const authed = authStore.isAuthenticated();
  // Whether this host runs in forced demo mode. Determined via the public
  // /api/demo/status endpoint (no PIN required).
  const [forced, setForced] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/demo/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { forced?: boolean } | null) => setForced(j?.forced === true))
      .catch(() => setForced(false));
  }, []);

  useEffect(() => {
    if (forced === null) return; // wait for status
    // On forced-demo hosts we skip the login flow entirely: write a placeholder
    // PIN so the auth-aware fetch wrappers stop redirecting to /login. The
    // backend bypasses the PIN check on these hosts anyway.
    if (forced && !authed) {
      authStore.setPin('demo');
      navigate({ to: '/', replace: true });
      return;
    }
    if (!authed && !isLogin) navigate({ to: '/login', replace: true });
    else if (authed && isLogin) navigate({ to: '/', replace: true });
  }, [authed, isLogin, navigate, forced]);

  if (forced === null) return <LoadingState label="Initialisation…" />;
  if (forced && !authed) return <LoadingState label="Initialisation…" />;
  if (isLogin) return <Outlet />;
  if (!authed) return null;

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
