import { registerSW } from 'virtual:pwa-register';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { toast } from 'sonner';
import { ApiError, setUnauthorizedHandler } from './lib/api';
import { router } from './router';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (count, error) =>
        !(error instanceof ApiError && error.status < 500 && error.status !== 0) && count < 2,
    },
    mutations: { retry: false },
  },
  queryCache: new QueryCache({
    onError: (error, query) => {
      // Background refetch failures shouldn't spam toasts; first loads show inline errors.
      if (query.state.data !== undefined && !(error instanceof ApiError && error.status === 401)) {
        toast.error(`Couldn’t refresh: ${error.message}`);
      }
    },
  }),
});

setUnauthorizedHandler(() => {
  queryClient.clear();
  const path = window.location.pathname;
  // Invitation links explain themselves (and offer sign-in) before asking anyone to sign in.
  if (!['/login', '/signup'].includes(path) && !path.startsWith('/invite/')) {
    router.navigate({ to: '/login', search: { next: path === '/' ? undefined : path } });
  }
});

if (import.meta.env.PROD) {
  const update = registerSW({
    onNeedRefresh() {
      toast('A new version is available', {
        duration: Number.POSITIVE_INFINITY,
        action: { label: 'Reload', onClick: () => update(true) },
      });
    },
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} context={{ queryClient }} />
    </QueryClientProvider>
  </StrictMode>,
);
