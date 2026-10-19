import type { DashboardDefinition, DataQuery } from '@perspice/shared';
import { registerWidget } from '@perspice/widgets';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { session } from '@/api/client';
import { AuthProvider } from '@/auth/AuthProvider';
import { fakeSocket } from '@/test/fake-socket';
import { baseHandlers, makeUser } from '@/test/render';
import { server } from '@/test/server';
import { DashboardView } from './DashboardView';

const device = {
  id: 'd1',
  name: 'Tower 17',
  profileId: 'p1',
  customerId: null,
  groupId: null,
  tags: [],
  status: 'online' as const,
  lastSeen: 1,
  firmwareVersion: null,
  serial: null,
  provisionedAt: null,
  location: null,
  offlineTimeoutS: null,
  deadTimeoutS: null,
  attributes: { client: {}, server: {}, shared: {} },
  createdAt: '',
  updatedAt: '',
};

const definition: DashboardDefinition = {
  states: [
    {
      id: 'main',
      name: 'Main',
      layout: [
        { i: 'fuel', x: 0, y: 0, w: 3, h: 3 },
        { i: 'boom', x: 3, y: 0, w: 3, h: 3 },
        { i: 'mystery', x: 6, y: 0, w: 3, h: 3 },
      ],
      widgets: [
        { id: 'fuel', type: 'value-card', title: 'Fuel', datasource: { kind: 'currentDevice', keys: ['fuel_level'] }, settings: {} },
        { id: 'boom', type: 'test-boom', title: 'Broken', datasource: { kind: 'none' }, settings: {} },
        { id: 'mystery', type: 'future-widget', title: 'Future', datasource: { kind: 'none' }, settings: {} },
      ],
    },
    {
      id: 'power',
      name: 'Power',
      layout: [{ i: 'batt', x: 0, y: 0, w: 3, h: 3 }],
      widgets: [{ id: 'batt', type: 'value-card', title: 'Battery', datasource: { kind: 'currentDevice', keys: ['batt_v'] }, settings: {} }],
    },
  ],
  settings: { timewindow: { kind: 'relative', lastMs: 86_400_000 }, refreshS: 0 },
};

beforeAll(() => {
  registerWidget({
    type: 'test-boom',
    name: 'Boom',
    description: '',
    icon: () => null,
    category: 'other',
    settingsSchema: z.object({}),
    data: { mode: null, sources: ['none'] },
    defaultSize: { w: 3, h: 3 },
    Component: () => {
      throw new Error('boom');
    },
  });
});

function wrap(children: ReactNode) {
  session.set(null);
  server.use(...baseHandlers(makeUser({ permissions: ['device.read', 'device.command'] })));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter>{children}</MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('DashboardView', () => {
  it('renders widgets with data, isolates a failing widget and labels unknown types', async () => {
    const bodies: DataQuery[] = [];
    server.use(
      http.post('*/api/dashboards/data', async ({ request }) => {
        const body = (await request.json()) as DataQuery;
        bodies.push(body);
        const results = Object.fromEntries(
          body.requests.map((r) => [r.widgetId, { ok: true, data: { device, values: { fuel_level: { ts: 1, v: 64.5 }, batt_v: { ts: 1, v: 52 } } } }]),
        );
        return HttpResponse.json({ results });
      }),
    );
    wrap(<DashboardView definition={definition} device={device} />);
    const fuel = await screen.findByTestId('widget-fuel');
    expect(await within(fuel).findByText('64.5')).toBeInTheDocument();
    expect(within(screen.getByTestId('widget-boom')).getByRole('alert')).toHaveTextContent('failed to display');
    expect(within(screen.getByTestId('widget-mystery')).getByText(/Unknown widget/)).toBeInTheDocument();
    expect(bodies[0]).toMatchObject({ deviceId: 'd1', requests: [{ widgetId: 'fuel', mode: 'latest' }] });
  });

  it('switches between dashboard views', async () => {
    server.use(
      http.post('*/api/dashboards/data', () =>
        HttpResponse.json({ results: { fuel: { ok: true, data: { device, values: {} } }, batt: { ok: true, data: { device, values: { batt_v: { ts: 1, v: 52 } } } } } }),
      ),
    );
    wrap(<DashboardView definition={definition} device={device} />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Power' }));
    expect(await within(await screen.findByTestId('widget-batt')).findByText('52')).toBeInTheDocument();
    expect(screen.queryByTestId('widget-fuel')).not.toBeInTheDocument();
  });

  it('applies live telemetry without refetching', async () => {
    let calls = 0;
    server.use(
      http.post('*/api/dashboards/data', () => {
        calls++;
        return HttpResponse.json({ results: { fuel: { ok: true, data: { device, values: { fuel_level: { ts: 1, v: 10 } } } } } });
      }),
    );
    wrap(<DashboardView definition={definition} device={device} />);
    const fuel = await screen.findByTestId('widget-fuel');
    await within(fuel).findByText('10');
    await waitFor(() => expect(fakeSocket.emitted).toContainEqual(['subscribe:devices', { deviceIds: ['d1'] }]));
    fakeSocket.serverEmit('telemetry', { deviceId: 'd1', values: { fuel_level: { ts: 2, v: 11.5 } } });
    expect(await within(fuel).findByText('11.5')).toBeInTheDocument();
    expect(calls).toBe(1);
  });

  it('fetches once more when the live subscription is answered, then counts as live', async () => {
    // Readings published between the first fetch and the server joining the device's room never
    // arrive as events; the second fetch picks them up.
    let calls = 0;
    server.use(
      http.post('*/api/dashboards/data', () => {
        calls++;
        return HttpResponse.json({ results: { fuel: { ok: true, data: { device, values: { fuel_level: { ts: calls, v: calls === 1 ? 10 : 12 } } } } } });
      }),
    );
    wrap(<DashboardView definition={definition} device={device} />);
    const fuel = await screen.findByTestId('widget-fuel');
    await within(fuel).findByText('10');
    expect(fuel).toHaveAttribute('data-live', 'false');

    fakeSocket.answerRooms();
    expect(await within(fuel).findByText('12')).toBeInTheDocument();
    await waitFor(() => expect(fuel).toHaveAttribute('data-live', 'true'));
    expect(calls).toBe(2);
  });
});
