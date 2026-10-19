import type { DeviceDto, DeviceProfileDto } from '@perspice/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fakeSocket } from '@/test/fake-socket';
import { makeUser, renderApp } from '@/test/render';
import { server } from '@/test/server';
import { TokenDialog } from './CredentialsPanel';
import { LatestValuesPanel } from './LatestValuesPanel';
import { StatusBadge } from './StatusBadge';

const device = (overrides: Partial<DeviceDto> = {}): DeviceDto => ({
  id: 'd1',
  name: 'Tower 17',
  profileId: 'p1',
  customerId: null,
  groupId: null,
  tags: [],
  status: 'online',
  lastSeen: Date.now(),
  firmwareVersion: null,
  serial: null,
  provisionedAt: null,
  location: null,
  offlineTimeoutS: null,
  deadTimeoutS: null,
  attributes: { client: {}, server: {}, shared: {} },
  latest: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

const profile: DeviceProfileDto = {
  id: 'p1',
  name: 'Telecom RMS',
  description: null,
  telemetrySchema: [{ key: 'fuel_level', label: 'Fuel level', unit: '%', type: 'number', decimals: 1 }],
  commands: [{ name: 'gen_start', label: 'Start generator', confirm: true }],
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
};

const operator = makeUser({
  scopeType: 'customer',
  customerId: 'c1',
  roleKey: 'customer_operator',
  permissions: ['device.read', 'device.command', 'profile.read', 'telemetry.read', 'notification.read'],
});

describe('StatusBadge', () => {
  it('renders a text label for every status', () => {
    const { rerender } = render(<StatusBadge status="online" />);
    expect(screen.getByText('Online')).toBeInTheDocument();
    for (const [status, label] of [
      ['offline', 'Offline'],
      ['dead', 'Dead'],
      ['never', 'Never connected'],
    ] as const) {
      rerender(<StatusBadge status={status} />);
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});

describe('LatestValuesPanel', () => {
  it('formats values with the profile decimals and unit', () => {
    render(<LatestValuesPanel device={device({ latest: { fuel_level: { ts: Date.now(), v: 64.567 } } })} schema={profile.telemetrySchema} />);
    expect(screen.getByTestId('value-fuel_level')).toHaveTextContent('64.6 %');
    expect(screen.getByText('Fuel level')).toBeInTheDocument();
  });
});

describe('device commands', () => {
  it('asks for confirmation before sending a confirm:true command', async () => {
    let posts = 0;
    server.use(
      http.get('*/api/devices/d1', () => HttpResponse.json(device())),
      http.get('*/api/device-profiles/p1', () => HttpResponse.json(profile)),
      http.get('*/api/devices/d1/commands', () => HttpResponse.json([])),
      http.post('*/api/devices/d1/commands', () => {
        posts++;
        return HttpResponse.json({ id: 'c1', name: 'gen_start', params: {}, status: 'sent', result: null, createdAt: Date.now(), completedAt: null });
      }),
    );
    const user = userEvent.setup();
    renderApp('/devices/d1', { user: operator });
    await user.click(await screen.findByRole('tab', { name: 'Commands' }));
    await user.click(await screen.findByRole('button', { name: 'Send' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Start generator?' })).toBeInTheDocument();
    expect(posts).toBe(0);
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(posts).toBe(1));
  });
});

describe('live status', () => {
  it('updates a row badge from a socket event without refetching', async () => {
    let listCalls = 0;
    server.use(
      http.get('*/api/devices', () => {
        listCalls++;
        return HttpResponse.json({ items: [device({ status: 'online' })], nextCursor: null });
      }),
    );
    renderApp('/devices', { user: operator });
    const row = await screen.findByTestId('device-row-d1');
    expect(within(row).getByText('Online')).toBeInTheDocument();
    fakeSocket.serverEmit('status', { deviceId: 'd1', from: 'online', to: 'offline', ts: Date.now() });
    expect(await within(row).findByText('Offline')).toBeInTheDocument();
    expect(listCalls).toBe(1);
    expect(fakeSocket.emitted).toContainEqual(['subscribe:status', {}]);
  });
});

describe('TokenDialog', () => {
  it('shows the token once and hides it when closed', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [token, setToken] = useState<string | null>('pdt_secret');
      return <TokenDialog deviceId="d1" token={token} onClose={() => setToken(null)} />;
    }
    render(<Harness />);
    expect(screen.getByTestId('device-token')).toHaveTextContent('pdt_secret');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByTestId('device-token')).not.toBeInTheDocument());
    expect(screen.queryByText(/pdt_secret/)).not.toBeInTheDocument();
  });
});

describe('TokenDialog on AWS IoT Core', () => {
  it('offers the AWS IoT Core certificate and key once, as downloads', async () => {
    const bundle = { endpoint: 'abc-ats.iot.eu-west-1.amazonaws.com', clientId: 'd1', certificatePem: 'CERT', privateKey: 'KEY', rootCaUrl: 'https://www.amazontrust.com/repository/AmazonRootCA1.pem', topicPrefix: 'perspice/v1/d1/' };
    const saved: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download);
    });
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    const user = userEvent.setup();
    render(<TokenDialog deviceId="d1" token="pdt_secret" awsIot={bundle} onClose={() => undefined} />);
    const section = screen.getByTestId('aws-iot-bundle');
    expect(section).toHaveTextContent('abc-ats.iot.eu-west-1.amazonaws.com:8883');
    await user.click(screen.getByRole('button', { name: 'Download certificate' }));
    await user.click(screen.getByRole('button', { name: 'Download private key' }));
    expect(saved).toEqual(['d1.cert.pem', 'd1.private.key']);
    click.mockRestore();
  });
});

describe('NotificationsBell', () => {
  it('increments the unread count when a notification arrives', async () => {
    server.use(http.get('*/api/notifications/unread-count', () => HttpResponse.json({ count: 2 })));
    renderApp('/', { user: operator });
    expect(await screen.findByTestId('unread-count')).toHaveTextContent('2');
    fakeSocket.serverEmit('notification', {
      id: 'n1',
      type: 'device.offline',
      severity: 'warning',
      title: 'Device offline: Tower 17',
      body: '',
      link: '/devices/d1',
      readAt: null,
      createdAt: Date.now(),
    });
    await waitFor(() => expect(screen.getByTestId('unread-count')).toHaveTextContent('3'));
    expect(await screen.findByText('Device offline: Tower 17')).toBeInTheDocument();
  });
});
