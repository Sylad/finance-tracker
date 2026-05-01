import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { Root } from './components/layout/root';
import { LoginPage } from './routes/login';
import { DashboardPage } from './routes/index';
import { HistoryPage } from './routes/history';
import { StatementDetailPage } from './routes/statement.$id';
import { BudgetPage } from './routes/budget';
import { RecurringPage } from './routes/recurring';
import { DeclarationsPage } from './routes/declarations';
import { ForecastPage } from './routes/forecast';
import { YearlyPage } from './routes/yearly';
import { UploadPage } from './routes/upload';
import { AboutPage } from './routes/about';

const rootRoute = createRootRoute({ component: Root });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: DashboardPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

const historyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/history',
  component: HistoryPage,
});

const statementRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/history/$id',
  component: StatementDetailPage,
});

const budgetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/budget',
  component: BudgetPage,
});

const recurringRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/recurring',
  component: RecurringPage,
});

const declarationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/declarations',
  component: DeclarationsPage,
});

const forecastRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forecast',
  component: ForecastPage,
});

const yearlyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/yearly',
  component: YearlyPage,
});

const uploadRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/upload',
  component: UploadPage,
});

const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/about',
  component: AboutPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  historyRoute,
  statementRoute,
  budgetRoute,
  recurringRoute,
  declarationsRoute,
  forecastRoute,
  yearlyRoute,
  uploadRoute,
  aboutRoute,
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
