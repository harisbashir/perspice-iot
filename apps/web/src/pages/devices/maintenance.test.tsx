import type { DeviceDto, DeviceProfileDto, DeviceServiceDto } from '@perspice/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { makeUser, renderApp } from '@/test/render';
import { server } from '@/test/server';

const profile = {
  id: 'p1',
  name: 'Generator',
  telemetrySchema: [{ key: 'gen_running', label: 'Running', type: 'boolean' }],
  commands: [],
  locationMode: 'none',
  trips: { enabled: false },
  calculated: [{ key: 'run_s', label: 'Generator run time', unit: 's', kind: 'runtime', source: 'gen_running', gapCapS: 900 }],
} as unknown as DeviceProfileDto;

const device = {
  id: 'd1',
  name: 'Site 4 generator',
  profileId: 'p1',
  customerId: 'c1',
  groupId: null,
  tags: [],
  status: 'online',
  lastSeen: Date.now(),
  firmwareVersion: null,
  location: null,
  offlineTimeoutS: null,
  deadTimeoutS: null,
  attributes: { client: {}, server: {}, shared: {} },
  latest: {},
  createdAt: '',
  updatedAt: '',
} satisfies DeviceDto;

const operator = makeUser({ scopeType: 'customer', customerId: 'c1', roleKey: 'customer_operator', permissions: ['device.read', 'device.service', 'telemetry.read'] });

describe('maintenance tab', () => {
  it('shows run hours and the service history, and logs a service', async () => {
    let logged: { note?: string; servicedAt?: number } | null = null;
    let services: DeviceServiceDto[] = [];
    server.use(
      http.get('*/api/devices/d1', () => HttpResponse.json(device)),
      http.get('*/api/device-profiles/p1', () => HttpResponse.json(profile)),
      http.get('*/api/devices/d1/run-hours', () =>
        HttpResponse.json(logged ? { key: 'run_s', total: 251, sinceService: 0, lastService: services[0]! } : { key: 'run_s', total: 251, sinceService: 251, lastService: null }),
      ),
      http.get('*/api/devices/d1/services', () => HttpResponse.json(services)),
      http.post('*/api/devices/d1/services', async ({ request }) => {
        logged = (await request.json()) as typeof logged;
        services = [{ id: 's1', deviceId: 'd1', servicedAt: logged!.servicedAt ?? 0, note: logged!.note ?? '', runHours: { run_s: 251 }, createdBy: 'u1' }];
        return HttpResponse.json(services[0]!, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderApp('/devices/d1', { user: operator });
    await user.click(await screen.findByRole('tab', { name: 'Maintenance' }));
    const card = await screen.findByTestId('run-hours-run_s');
    await waitFor(() => expect(card).toHaveTextContent('251 h'));
    expect(card).toHaveTextContent('251 h since it was added');
    expect(screen.getByText('No services logged yet.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Note'), 'Oil and filters');
    await user.click(screen.getByRole('button', { name: 'Log service' }));
    await waitFor(() => expect(logged).toMatchObject({ note: 'Oil and filters', servicedAt: expect.any(Number) }));
    await waitFor(() => expect(card).toHaveTextContent('0 h since the last service'));
    const row = (await screen.findByText('Oil and filters')).closest('tr')!;
    expect(within(row).getByText('Generator run time: 251 h')).toBeInTheDocument();
  });

  it("viewers can't log services", async () => {
    server.use(
      http.get('*/api/devices/d1', () => HttpResponse.json(device)),
      http.get('*/api/device-profiles/p1', () => HttpResponse.json({ ...profile, calculated: [] })),
      http.get('*/api/devices/d1/services', () => HttpResponse.json([])),
    );
    const user = userEvent.setup();
    renderApp('/devices/d1', { user: makeUser({ scopeType: 'customer', customerId: 'c1', permissions: ['device.read', 'telemetry.read'] }) });
    await user.click(await screen.findByRole('tab', { name: 'Maintenance' }));
    expect(await screen.findByText(/This profile has no run-time key/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Log service' })).not.toBeInTheDocument();
  });
});
