import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';
import { periodLabel } from './PrintDashboard';

const T = Date.UTC(2026, 0, 2, 12, 0);
const device = { id: 'd1', name: 'Tower 17', status: 'online', lastSeen: T, profileId: 'p1', customerId: 'c1' };

const session = {
  session: 'rs_1',
  title: 'Tower 17 — Site view',
  generatedAt: T,
  timewindow: { kind: 'relative', lastMs: 86_400_000 },
  stateId: 'main',
  viewer: { scopeType: 'customer' },
  branding: { productName: 'Acme Monitor', primaryColor: '#0f766e', accentColor: '#f59e0b', logoLightUrl: null, logoDarkUrl: null, faviconUrl: null, loginBackgroundUrl: null, supportEmail: null, customCss: null },
  dashboard: {
    instanceId: 'i1',
    templateId: 't1',
    templateName: 'Site view',
    templateVersion: 1,
    overridden: false,
    baseVersion: null,
    outdated: false,
    definition: {
      states: [
        {
          id: 'main',
          name: 'Main',
          layout: [{ i: 'w1', x: 0, y: 0, w: 4, h: 3 }],
          widgets: [{ id: 'w1', type: 'value-card', title: 'Fuel', datasource: { kind: 'currentDevice', keys: ['fuel_level'] }, settings: {} }],
        },
      ],
      settings: { timewindow: { kind: 'relative', lastMs: 3_600_000 }, refreshS: 0 },
    },
  },
  device: { ...device, tags: [], attributes: { client: {}, server: {}, shared: {} }, latest: {} },
  profile: { id: 'p1', name: 'Tower', telemetrySchema: [{ key: 'fuel_level', label: 'Fuel', unit: '%', type: 'number' }], commands: [] },
};

describe('PrintDashboard', () => {
  it('renders the bound dashboard with branding and period, then reports ready', async () => {
    let sessions = 0;
    let dataBody: unknown;
    server.use(
      http.post('*/api/print/session', async ({ request }) => {
        sessions++;
        expect(await request.json()).toEqual({ rt: 'rt_abc' });
        return HttpResponse.json(session);
      }),
      http.post('*/api/print/data', async ({ request }) => {
        dataBody = await request.json();
        return HttpResponse.json({ results: { w1: { ok: true, data: { device, values: { fuel_level: { ts: T, v: 64.5 } } } } } });
      }),
    );
    const { container } = renderApp('/print/dashboard?rt=rt_abc');
    expect(await screen.findByRole('heading', { name: 'Tower 17 — Site view' })).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector('[data-print-state="ready"]')).not.toBeNull());
    expect(screen.getByText('Acme Monitor', { selector: 'div' })).toBeInTheDocument();
    expect(screen.getByText('2026-01-01 12:00 UTC – 2026-01-02 12:00 UTC')).toBeInTheDocument();
    expect(screen.getByText(/64\.5/)).toBeInTheDocument();
    expect(sessions).toBe(1);
    expect(dataBody).toMatchObject({ session: 'rs_1', requests: [{ widgetId: 'w1', mode: 'latest' }] });
    expect(document.documentElement.dataset.print).toBe('true');
  });

  it('reports an error state for a used or expired token', async () => {
    server.use(
      http.post('*/api/print/session', () => HttpResponse.json({ code: 'NOT_FOUND', message: 'This render link is invalid or has expired' }, { status: 404 })),
    );
    const { container } = renderApp('/print/dashboard?rt=rt_used');
    expect(await screen.findByText('This render link is invalid or has expired')).toBeInTheDocument();
    expect(container.querySelector('[data-print-state="error"]')).not.toBeNull();
  });

  it('labels absolute periods', () => {
    expect(periodLabel({ kind: 'absolute', fromMs: T, toMs: T + 3_600_000 }, 0)).toBe('2026-01-02 12:00 UTC – 2026-01-02 13:00 UTC');
  });
});
