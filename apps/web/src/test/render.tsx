import type { MeResponse } from '@perspice/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { session } from '@/api/client';
import { AuthProvider } from '@/auth/AuthProvider';
import { BrandingProvider, FALLBACK_BRANDING } from '@/branding/BrandingProvider';
import { Toaster } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { routes } from '@/router';
import { server } from './server';

export function makeUser(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    id: 'u1',
    email: 'user@example.com',
    name: 'Test User',
    scopeType: 'platform',
    customerId: null,
    customerSlug: null,
    groupId: null,
    roleId: 'r1',
    roleKey: 'platform_admin',
    permissions: [],
    totpEnabled: true,
    ...overrides,
  };
}

/** Base handlers: platform branding; signed out unless `user` is given (restored via refresh). */
export function baseHandlers(user?: MeResponse) {
  return [
    http.get('*/api/public/branding', () => HttpResponse.json(FALLBACK_BRANDING)),
    http.post('*/api/auth/refresh', () =>
      user
        ? HttpResponse.json({ accessToken: 'token-1', user })
        : HttpResponse.json({ code: 'UNAUTHENTICATED', message: 'Session expired' }, { status: 401 }),
    ),
  ];
}

export function renderApp(path: string, opts: { user?: MeResponse } = {}) {
  session.set(null);
  server.use(...baseHandlers(opts.user));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <BrandingProvider>
        <AuthProvider>
          <TooltipProvider>
            <Toaster>
              <RouterProvider router={router} />
            </Toaster>
          </TooltipProvider>
        </AuthProvider>
      </BrandingProvider>
    </QueryClientProvider>,
  );
  return { ...utils, router, queryClient };
}
