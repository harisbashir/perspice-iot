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
  http.get('*/api/dashboards/overview', () => HttpResponse.json({ dashboard: null })),
  http.get('*/api/alarms/summary', () => HttpResponse.json({ critical: 0, major: 0, minor: 0, warning: 0, total: 0, unacknowledged: 0 })),
  http.get('*/api/alarms', () => HttpResponse.json({ items: [], nextCursor: null })),
  http.get('*/api/alarm-rules', () => HttpResponse.json([])),
  http.get('*/api/dashboards/device/:id', () => HttpResponse.json({ dashboard: null })),
  http.get('*/api/firmware', () => HttpResponse.json([])),
  http.get('*/api/ota-jobs', () => HttpResponse.json([])),
  http.get('*/api/devices/:id/ota', () => HttpResponse.json([])),
  http.get('*/api/devices/:id/asset', () => HttpResponse.json({ asset: null })),
  http.get('*/api/assets/tree', () => HttpResponse.json([])),
  http.get('*/api/asset-types', () => HttpResponse.json([])),
];

/** Shared MSW server; tests register handlers with `server.use(...)`. */
export const server = setupServer(...defaultHandlers);
