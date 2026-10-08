import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { FALLBACK_BRANDING } from '@/branding/BrandingProvider';

/** Lowest-priority defaults so pages that load extra data don't trip unhandled-request errors. */
export const defaultHandlers = [
  http.get('*/api/public/branding', () => HttpResponse.json(FALLBACK_BRANDING)),
  http.get('*/api/devices/stats', () => HttpResponse.json({ total: 0, online: 0, offline: 0, dead: 0, never: 0 })),
  http.get('*/api/devices', () => HttpResponse.json({ items: [], nextCursor: null })),
  http.get('*/api/device-profiles', () => HttpResponse.json([])),
  http.get('*/api/notifications/unread-count', () => HttpResponse.json({ count: 0 })),
  http.get('*/api/notifications', () => HttpResponse.json({ items: [], nextCursor: null })),
  http.get('*/api/customers', () => HttpResponse.json([])),
  http.get('*/api/users', () => HttpResponse.json([])),
  http.get('*/api/roles', () => HttpResponse.json([])),
];

/** Shared MSW server; tests register handlers with `server.use(...)`. */
export const server = setupServer(...defaultHandlers);
