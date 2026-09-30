import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
} from '@tanstack/react-router';
import { Toaster } from 'sonner';
import { z } from 'zod';
import { AppLayout } from './app/app-layout';
import { NotFoundPage } from './app/not-found';
import { useThemeClass } from './app/theme';
import { ConfirmProvider } from './components/ui/dialog';
import { TooltipProvider } from './components/ui/menu';
import { LoginPage, SignupPage } from './features/auth/auth-pages';
import { OnboardingPage } from './features/onboarding/onboarding-page';

function Root() {
  const theme = useThemeClass();
  return (
    <TooltipProvider delayDuration={300}>
      <ConfirmProvider>
        <Outlet />
        <Toaster theme={theme} position="top-center" richColors closeButton offset={16} />
      </ConfirmProvider>
    </TooltipProvider>
  );
}

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Root,
  notFoundComponent: NotFoundPage,
});

const authSearch = z.object({ next: z.string().optional() });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: authSearch,
  component: LoginPage,
});

const signupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/signup',
  component: SignupPage,
});

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/onboarding',
  component: OnboardingPage,
});

const appRoute = createRoute({ getParentRoute: () => rootRoute, id: 'app', component: AppLayout });

const dashboardRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  validateSearch: z.object({ date: z.string().optional() }),
  component: lazyRouteComponent(
    () => import('./features/dashboard/dashboard-page'),
    'DashboardPage',
  ),
});

export const transactionsSearch = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  accountIds: z.string().optional(),
  categoryIds: z.string().optional(),
  payeeIds: z.string().optional(),
  tagIds: z.string().optional(),
  type: z.enum(['expense', 'income', 'transfer']).optional(),
  q: z.string().optional(),
  needsReview: z.enum(['true', 'false']).optional(),
  importBatchId: z.string().optional(),
  recurringId: z.string().optional(),
  deleted: z.enum(['true', 'false']).optional(),
});
export type TransactionsSearch = z.infer<typeof transactionsSearch>;

const transactionsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/transactions',
  validateSearch: transactionsSearch,
  component: lazyRouteComponent(
    () => import('./features/transactions/transactions-page'),
    'TransactionsPage',
  ),
});

const budgetsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/budgets',
  validateSearch: z.object({
    date: z.string().optional(),
    view: z.enum(['budget', 'goals']).optional(),
  }),
  component: lazyRouteComponent(() => import('./features/budgets/budgets-page'), 'BudgetsPage'),
});

export const reportsSearch = z.object({
  tab: z
    .enum([
      'spending',
      'cashflow',
      'trends',
      'budget',
      'networth',
      'payees',
      'tags',
      'compare',
      'calendar',
    ])
    .optional(),
  preset: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  accountIds: z.string().optional(),
});

const reportsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/reports',
  validateSearch: reportsSearch,
  component: lazyRouteComponent(() => import('./features/reports/reports-page'), 'ReportsPage'),
});

const accountsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/accounts',
  component: lazyRouteComponent(() => import('./features/accounts/accounts-page'), 'AccountsPage'),
});

const accountRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/accounts/$accountId',
  component: lazyRouteComponent(() => import('./features/accounts/account-page'), 'AccountPage'),
});

const importRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/import',
  component: lazyRouteComponent(() => import('./features/import/import-page'), 'ImportPage'),
});

const recurringRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/recurring',
  component: lazyRouteComponent(
    () => import('./features/recurring/recurring-page'),
    'RecurringPage',
  ),
});

const inboxRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/inbox',
  validateSearch: z.object({ tab: z.enum(['review', 'uncategorized']).optional() }),
  component: lazyRouteComponent(() => import('./features/inbox/inbox-page'), 'InboxPage'),
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  validateSearch: z.object({
    tab: z
      .enum(['general', 'categories', 'payees', 'tags', 'rules', 'rates', 'data', 'profile'])
      .optional(),
  }),
  component: lazyRouteComponent(() => import('./features/settings/settings-page'), 'SettingsPage'),
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  signupRoute,
  onboardingRoute,
  appRoute.addChildren([
    dashboardRoute,
    transactionsRoute,
    budgetsRoute,
    reportsRoute,
    accountsRoute,
    accountRoute,
    importRoute,
    inboxRoute,
    recurringRoute,
    settingsRoute,
  ]),
]);

export const router = createRouter({
  routeTree,
  context: { queryClient: undefined! },
  defaultPreload: 'intent',
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
