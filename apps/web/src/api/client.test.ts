import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { server } from '@/test/server';
import { ApiError, api, session } from './client';

describe('api client', () => {
  beforeEach(() => session.set(null));

  it('refreshes once on 401 and retries with the new token', async () => {
    session.set({ accessToken: 'expired', user: {} as never });
    let refreshes = 0;
    const seen: (string | null)[] = [];
    server.use(
      http.get('*/api/devices', ({ request }) => {
        const auth = request.headers.get('authorization');
        seen.push(auth);
        return auth === 'Bearer fresh'
          ? HttpResponse.json({ items: [] })
          : HttpResponse.json({ code: 'UNAUTHENTICATED', message: 'x' }, { status: 401 });
      }),
      http.post('*/api/auth/refresh', () => {
        refreshes++;
        return HttpResponse.json({ accessToken: 'fresh', user: { id: 'u1' } });
      }),
    );
    // Two concurrent calls share a single refresh.
    const [a, b] = await Promise.all([api('/devices'), api('/devices')]);
    expect(a).toEqual({ items: [] });
    expect(b).toEqual({ items: [] });
    expect(refreshes).toBe(1);
    expect(seen.filter((s) => s === 'Bearer fresh')).toHaveLength(2);
  });

  it('gives up after one failed refresh and throws the problem as ApiError', async () => {
    server.use(
      http.get('*/api/devices', () => HttpResponse.json({ code: 'UNAUTHENTICATED', message: 'nope' }, { status: 401 })),
      http.post('*/api/auth/refresh', () => HttpResponse.json({ code: 'UNAUTHENTICATED', message: 'x' }, { status: 401 })),
    );
    const err = await api('/devices').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
  });

  it('serialises query parameters and JSON bodies', async () => {
    server.use(
      http.post('*/api/things', async ({ request }) => {
        const url = new URL(request.url);
        return HttpResponse.json({ q: url.searchParams.get('q'), body: await request.json() });
      }),
    );
    expect(await api('/things', { body: { a: 1 }, query: { q: 'x', skip: undefined } })).toEqual({ q: 'x', body: { a: 1 } });
  });
});
