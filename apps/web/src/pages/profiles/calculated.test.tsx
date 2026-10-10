import type { DeviceDto, DeviceProfileDto } from '@perspice/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { makeUser, renderApp } from '@/test/render';
import { server } from '@/test/server';

const admin = makeUser({ permissions: ['profile.read', 'profile.write', 'device.read', 'telemetry.read'] });

const profile = (overrides: Partial<DeviceProfileDto> = {}): DeviceProfileDto => ({
  id: 'p1',
  name: 'Meter',
  description: null,
  telemetrySchema: [
    { key: 'v', label: 'Voltage', unit: 'V', type: 'number' },
    { key: 'i', label: 'Current', unit: 'A', type: 'number' },
  ],
  commands: [],
  offlineTimeoutS: 300,
  deadTimeoutS: 86400,
  sleepy: false,
  transport: 'mqtt',
  retentionDays: 365,
  statusNotify: { enabled: false, roleKeys: [], channels: [] },
  locationMode: 'none',
  locationKeys: { lat: 'lat', lng: 'lng', alt: 'alt', speed: 'speed', heading: 'heading', accuracy: 'acc' },
  trips: { enabled: false, minSpeedKmh: 5, minMoveM: 50, stopAfterS: 300 },
  calculated: [],
  defaultDashboardTemplateId: null,
  createdAt: '',
  updatedAt: '',
  ...overrides,
});

const device = (overrides: Partial<DeviceDto> = {}): DeviceDto => ({
  id: 'd1',
  name: 'Meter 1',
  profileId: 'p1',
  customerId: null,
  groupId: null,
  tags: [],
  status: 'online',
  lastSeen: Date.now(),
  firmwareVersion: null,
  location: null,
  offlineTimeoutS: null,
  deadTimeoutS: null,
  attributes: { client: {}, server: {}, shared: {} },
  latest: { v: { ts: Date.now(), v: 230 }, i: { ts: Date.now(), v: 4 } },
  createdAt: '',
  updatedAt: '',
  ...overrides,
});

describe('calculated keys in the profile editor', () => {
  it('checks definitions as you type and saves them with the profile', async () => {
    let saved: { calculated?: unknown } | null = null;
    server.use(
      http.get('*/api/device-profiles/p1', () => HttpResponse.json(profile())),
      http.patch('*/api/device-profiles/p1', async ({ request }) => {
        saved = (await request.json()) as typeof saved;
        return HttpResponse.json(profile());
      }),
    );
    const user = userEvent.setup();
    renderApp('/profiles/p1', { user: admin });
    await user.click(await screen.findByRole('button', { name: 'Add calculated key' }));
    const row = screen.getByTestId('calculated-0');
    await user.type(within(row).getByLabelText('Calculated key'), 'v');
    await user.type(within(row).getByLabelText('Calculated label'), 'Power');
    await user.type(within(row).getByLabelText('Formula'), 'v * ');
    expect(within(row).getByText('"v" is already a telemetry key')).toBeInTheDocument();
    expect(within(row).getByText('Expected a value (at 4)')).toBeInTheDocument();

    await user.clear(within(row).getByLabelText('Calculated key'));
    await user.type(within(row).getByLabelText('Calculated key'), 'power');
    await user.type(within(row).getByLabelText('Formula'), 'i');
    expect(within(row).queryByRole('alert')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add calculated key' }));
    const second = screen.getByTestId('calculated-1');
    await user.type(within(second).getByLabelText('Calculated key'), 'run_s');
    await user.type(within(second).getByLabelText('Calculated label'), 'Run time');
    await user.selectOptions(within(second).getByLabelText('Kind'), 'runtime');
    await user.selectOptions(within(second).getByLabelText('Source'), 'power');

    await user.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(saved).not.toBeNull());
    expect(saved!.calculated).toEqual([
      { key: 'power', label: 'Power', kind: 'formula', expr: 'v * i' },
      { key: 'run_s', label: 'Run time', kind: 'runtime', source: 'power', gapCapS: 900 },
    ]);
  });

  it("previews formulas on one of the profile's devices", async () => {
    server.use(
      http.get('*/api/device-profiles/p1', () =>
        HttpResponse.json(profile({ calculated: [{ key: 'power', label: 'Power', kind: 'formula', expr: 'v * i' }, { key: 'kw', label: 'kW', kind: 'formula', expr: 'power / 1000' }] })),
      ),
      http.get('*/api/devices', () => HttpResponse.json({ items: [device({ latest: undefined as never })], nextCursor: null })),
      http.get('*/api/devices/d1', () => HttpResponse.json(device())),
    );
    const user = userEvent.setup();
    renderApp('/profiles/p1', { user: admin });
    await user.selectOptions(await screen.findByLabelText('Preview device'), 'd1');
    await waitFor(() => expect(screen.getAllByTestId('formula-preview').map((e) => e.textContent)).toEqual(['= 920', '= 0.92']));
  });
});

describe('calculated keys on the device page', () => {
  it('labels and formats calculated values like telemetry', async () => {
    server.use(
      http.get('*/api/devices/d1', () => HttpResponse.json(device({ latest: { power: { ts: Date.now(), v: 920.456 } } }))),
      http.get('*/api/device-profiles/p1', () => HttpResponse.json(profile({ calculated: [{ key: 'power', label: 'Power', unit: 'W', decimals: 1, kind: 'formula', expr: 'v * i' }] }))),
    );
    const user = userEvent.setup();
    renderApp('/devices/d1', { user: admin });
    await user.click(await screen.findByRole('tab', { name: 'Overview' }));
    expect(await screen.findByTestId('value-power')).toHaveTextContent('920.5 W');
    expect(screen.getByText('Power')).toBeInTheDocument();
  });
});
