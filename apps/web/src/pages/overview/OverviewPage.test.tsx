import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { fakeSocket } from '@/test/fake-socket';
import { makeUser, renderApp } from '@/test/render';
import { server } from '@/test/server';

const fleet = { kind: 'devicesOfProfile', profileId: null, keys: [] };
const overview = {
  instanceId: 'i1',
  templateId: 't1',
  templateName: 'Overview',
  templateVersion: 1,
  overridden: false,
  baseVersion: null,
  outdated: false,
  definition: {
    states: [
      {
        id: 'main',
        name: 'Overview',
        layout: [
          { i: 'kpi-online', x: 0, y: 0, w: 2, h: 3 },
          { i: 'devices', x: 0, y: 3, w: 12, h: 10 },
        ],
        widgets: [
          { id: 'kpi-online', type: 'kpi', title: 'Online', datasource: fleet, settings: { metric: 'online' } },
          {
            id: 'devices',
            type: 'entity-table',
            title: 'Devices',
            datasource: { kind: 'entityList', profileId: null, columns: ['status', 'name', 'customer'], pageSize: 25 },
            settings: { linkToDevice: true },
          },
        ],
      },
    ],
    settings: { timewindow: { kind: 'relative', lastMs: 86_400_000 }, refreshS: 0 },
  },
};
const item = { id: 'd1', name: 'Tower 17', status: 'offline', lastSeen: null, profileId: 'p1', customerId: 'c1', profileName: 'Tower', customerName: 'Acme', values: {} };

function handlers() {
  server.use(
    http.get('*/api/dashboards/overview', () => HttpResponse.json(overview)),
    http.post('*/api/dashboards/data', () =>
      HttpResponse.json({
        results: {
          'kpi-online': { ok: true, data: { total: 3, online: 1, offline: 2, dead: 0, never: 0, messages24h: 0 } },
          devices: { ok: true, data: { items: [item], total: 1, page: 0, pageSize: 25, customers: [{ id: 'c1', name: 'Acme' }] } },
        },
      }),
    ),
  );
}

const platform = makeUser({ scopeType: 'platform', permissions: ['device.read'] });
const customerUser = makeUser({ scopeType: 'customer', customerId: 'c1', permissions: ['device.read'] });

describe('OverviewPage', () => {
  it('shows the customer column and filter to platform users', async () => {
    handlers();
    renderApp('/', { user: platform });
    expect(await screen.findByRole('columnheader', { name: /Customer/ })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filter by customer' })).toBeInTheDocument();
  });

  it('hides customers from customer users', async () => {
    handlers();
    renderApp('/', { user: customerUser });
    await screen.findByRole('link', { name: 'Tower 17' });
    expect(screen.queryByRole('columnheader', { name: /Customer/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Filter by customer' })).not.toBeInTheDocument();
  });

  it('keeps KPI tiles live from the status feed', async () => {
    handlers();
    fakeSocket.reset();
    renderApp('/', { user: platform });
    const tile = await screen.findByRole('region', { name: 'Online' });
    await waitFor(() => expect(within(tile).getByText('1')).toBeInTheDocument());
    await waitFor(() => expect(fakeSocket.emitted).toContainEqual(['subscribe:status', {}]));
    fakeSocket.serverEmit('status', { deviceId: 'd1', from: 'offline', to: 'online', ts: Date.now() });
    await waitFor(() => expect(within(tile).getByText('2')).toBeInTheDocument());
  });

  it('opens the device dashboard from the device table', async () => {
    handlers();
    const { router } = renderApp('/', { user: platform });
    await userEvent.click(await screen.findByRole('link', { name: 'Tower 17' }));
    expect(router.state.location.pathname).toBe('/devices/d1');
  });

  it('says so when there is no overview dashboard', async () => {
    renderApp('/', { user: platform });
    expect(await screen.findByText(/No overview dashboard is set up/)).toBeInTheDocument();
  });
});
