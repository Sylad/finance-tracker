import { Outlet, useRouterState, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { authStore } from '@/lib/auth';
import { AppShell } from './app-shell';

export function Root() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const isLogin = pathname.startsWith('/login');
  const authed = authStore.isAuthenticated();

  useEffect(() => {
    if (!authed && !isLogin) {
      navigate({ to: '/login', replace: true });
    } else if (authed && isLogin) {
      navigate({ to: '/', replace: true });
    }
  }, [authed, isLogin, navigate]);

  if (isLogin) return <Outlet />;
  if (!authed) return null;

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
