import { lazy, Suspense } from 'react';
import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { Navigate } from '@tanstack/react-router';
import { Root } from './components/layout/root';
import { LoadingState } from '@/components/loading-state';

// Route components are lazy-loaded so each becomes its own chunk. The Root
// layout shell, providers and LoadingState stay on the critical path.
const LoginPage = lazy(() =>
  import('./routes/login').then((m) => ({ default: m.LoginPage })),
);
const DashboardPage = lazy(() =>
  import('./routes/index').then((m) => ({ default: m.DashboardPage })),
);
const HistoryPage = lazy(() =>
  import('./routes/history').then((m) => ({ default: m.HistoryPage })),
);
const StatementDetailPage = lazy(() =>
  import('./routes/statement.$id').then((m) => ({ default: m.StatementDetailPage })),
);
const BudgetPage = lazy(() =>
  import('./routes/budget').then((m) => ({ default: m.BudgetPage })),
);
const IncomePage = lazy(() =>
  import('./routes/income').then((m) => ({ default: m.IncomePage })),
);
const DeclarationsPage = lazy(() =>
  import('./routes/declarations').then((m) => ({ default: m.DeclarationsPage })),
);
const ForecastPage = lazy(() =>
  import('./routes/forecast').then((m) => ({ default: m.ForecastPage })),
);
const YearlyPage = lazy(() =>
  import('./routes/yearly').then((m) => ({ default: m.YearlyPage })),
);
const UploadPage = lazy(() =>
  import('./routes/upload').then((m) => ({ default: m.UploadPage })),
);
const AboutPage = lazy(() =>
  import('./routes/about').then((m) => ({ default: m.AboutPage })),
);
const SavingsPage = lazy(() =>
  import('./routes/savings').then((m) => ({ default: m.SavingsPage })),
);
const LoansPage = lazy(() =>
  import('./routes/loans').then((m) => ({ default: m.LoansPage })),
);
const SubscriptionsPage = lazy(() =>
  import('./routes/subscriptions').then((m) => ({ default: m.SubscriptionsPage })),
);
const CategoryRulesPage = lazy(() =>
  import('./routes/category-rules').then((m) => ({ default: m.CategoryRulesPage })),
);
const GoalsPage = lazy(() =>
  import('./routes/goals').then((m) => ({ default: m.GoalsPage })),
);
const HeatmapPage = lazy(() =>
  import('./routes/heatmap').then((m) => ({ default: m.HeatmapPage })),
);

// Wrap each lazy route component in a Suspense boundary scoped to the page,
// so the AppShell (sidebar/header) stays mounted while the chunk loads.
const withSuspense = (Component: React.ComponentType) => () =>
  (
    <Suspense fallback={<LoadingState />}>
      <Component />
    </Suspense>
  );

const rootRoute = createRootRoute({ component: Root });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: withSuspense(DashboardPage),
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: withSuspense(LoginPage),
});

const historyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/history',
  component: withSuspense(HistoryPage),
});

const statementRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/history/$id',
  component: withSuspense(StatementDetailPage),
});

const budgetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/budget',
  component: withSuspense(BudgetPage),
});

const incomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/income',
  component: withSuspense(IncomePage),
});

const recurringRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/recurring',
  component: () => <Navigate to="/income" replace />,
});

const declarationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/declarations',
  component: withSuspense(DeclarationsPage),
});

const forecastRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forecast',
  component: withSuspense(ForecastPage),
});

const yearlyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/yearly',
  component: withSuspense(YearlyPage),
});

const uploadRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/upload',
  component: withSuspense(UploadPage),
});

const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/about',
  component: withSuspense(AboutPage),
});

const savingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/savings',
  component: withSuspense(SavingsPage),
});

const loansRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/loans',
  component: withSuspense(LoansPage),
});

const subscriptionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/subscriptions',
  component: withSuspense(SubscriptionsPage),
});

const categoryRulesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/category-rules',
  component: withSuspense(CategoryRulesPage),
});

const goalsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/goals',
  component: withSuspense(GoalsPage),
});

const heatmapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/heatmap',
  component: withSuspense(HeatmapPage),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  historyRoute,
  statementRoute,
  budgetRoute,
  incomeRoute,
  recurringRedirectRoute,
  declarationsRoute,
  forecastRoute,
  yearlyRoute,
  uploadRoute,
  aboutRoute,
  savingsRoute,
  loansRoute,
  subscriptionsRoute,
  categoryRulesRoute,
  goalsRoute,
  heatmapRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

export function AppRouter() {
  return <RouterProvider router={router} />;
}
