import type { DeviceDto, DeviceProfileDto, GeofenceDto, TripDto } from '@perspice/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetMapServices } from '@/dashboards/map-services';
import { makeUser, renderApp } from '@/test/render';
import { server } from '@/test/server';

// Leaflet sizes maps from their container; jsdom reports 0.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
});
beforeEach(() => resetMapServices());

const profile = (overrides: Partial<DeviceProfileDto> = {}): DeviceProfileDto => ({
  id: 'p1',
  name: 'Van',
  description: null,
  telemetrySchema: [],
  commands: [],
  offlineTimeoutS: 300,
  deadTimeoutS: 86400,
  sleepy: false,
  transport: 'mqtt',
  retentionDays: 365,
  statusNotify: { enabled: false, roleKeys: [], channels: [] },
  locationMode: 'fixed',
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
  name: 'Van 7',
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
  ...overrides,
});

const admin = makeUser({ scopeType: 'customer', customerId: 'c1', permissions: ['device.read', 'device.write', 'telemetry.read', 'export.data', 'geofence.manage'] });

function deviceHandlers(d: DeviceDto, p: DeviceProfileDto) {
  server.use(
    http.get('*/api/devices/d1', () => HttpResponse.json(d)),
    http.get('*/api/device-profiles/p1', () => HttpResponse.json(p)),
    http.get('*/api/settings/map', () => HttpResponse.json({ urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OSM', maxZoom: 19 })),
  );
}

describe('device location tab', () => {
  it('shows the location and sets a fixed one by hand', async () => {
    let body: unknown;
    deviceHandlers(device({ location: { lat: 51.5, lng: -0.12, ts: Date.now(), source: 'fixed' } }), profile());
    server.use(
      http.put('*/api/devices/d1/location', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ location: { ...(body as object), ts: Date.now(), source: 'fixed' } });
      }),
    );
    const user = userEvent.setup();
    renderApp('/devices/d1', { user: admin });
    await user.click(await screen.findByRole('tab', { name: 'Location' }));
    expect(await screen.findByTestId('location-position')).toHaveTextContent('51.500000, -0.120000');
    await user.click(screen.getByRole('button', { name: 'Set location' }));
    await user.clear(screen.getByLabelText('Latitude'));
    await user.type(screen.getByLabelText('Latitude'), '48.8566');
    await user.clear(screen.getByLabelText('Longitude'));
    await user.type(screen.getByLabelText('Longitude'), '2.3522');
    await user.click(screen.getByRole('button', { name: 'Save location' }));
    await waitFor(() => expect(body).toEqual({ lat: 48.8566, lng: 2.3522 }));
    expect(await screen.findByTestId('location-position')).toHaveTextContent('48.856600, 2.352200');
  });

  it('has no location tab when the profile has no location', async () => {
    deviceHandlers(device(), profile({ locationMode: 'none' }));
    renderApp('/devices/d1', { user: admin });
    await screen.findByRole('tab', { name: 'Overview' });
    expect(screen.queryByRole('tab', { name: 'Location' })).not.toBeInTheDocument();
  });
});

describe('device trips tab', () => {
  it('lists trips with distance per day and an export', async () => {
    const trip: TripDto = { id: 't1', deviceId: 'd1', startTs: Date.UTC(2026, 6, 1, 8), endTs: Date.UTC(2026, 6, 1, 9, 30), start: { lat: 1, lng: 1 }, end: { lat: 2, lng: 2 }, distanceM: 42_300, maxSpeedKmh: 88, avgSpeedKmh: 28.2 };
    deviceHandlers(device(), profile({ locationMode: 'reported', trips: { enabled: true, minSpeedKmh: 5, minMoveM: 50, stopAfterS: 300 } }));
    server.use(
      http.get('*/api/devices/d1/trips', () => HttpResponse.json([trip])),
      http.get('*/api/devices/d1/distance', () => HttpResponse.json({ timezone: 'Europe/London', days: [{ day: '2026-07-01', distanceM: 42_300 }] })),
    );
    const user = userEvent.setup();
    renderApp('/devices/d1', { user: admin });
    await user.click(await screen.findByRole('tab', { name: 'Trips' }));
    const row = (await screen.findByText('42.3 km', { selector: 'td' })).closest('tr')!;
    expect(within(row).getByText('1 h 30 min')).toBeInTheDocument();
    expect(within(row).getByText('88 km/h')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Distance per day' })).getByText('2026-07-01')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export trips' })).toBeInTheDocument();
  });
});

describe('geofences page', () => {
  const depot: GeofenceDto = { id: 'g1', name: 'Depot', customerId: 'c1', color: '#2563eb', shape: { type: 'circle', center: { lat: 51.5, lng: -0.12 }, radiusM: 300 }, createdAt: 0, updatedAt: 0 };
  const port: GeofenceDto = { id: 'g2', name: 'Port', customerId: null, color: '#9333ea', shape: { type: 'circle', center: { lat: 51.4, lng: 0.1 }, radiusM: 900 }, createdAt: 0, updatedAt: 0 };

  beforeEach(() => {
    server.use(
      http.get('*/api/geofences', () => HttpResponse.json([depot, port])),
      http.get('*/api/settings/map', () => HttpResponse.json({ urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '', maxZoom: 19 })),
    );
  });

  it('lists geofences; platform-wide ones are read-only for customers', async () => {
    const { container } = renderApp('/geofences', { user: admin });
    const list = await screen.findByRole('list', { name: 'Geofence list' });
    await within(list).findByText('Depot');
    expect(within(list).getByText('(platform-wide)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Depot' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Port' })).not.toBeInTheDocument();
    await waitFor(() => expect(container.querySelectorAll('.perspice-geofence')).toHaveLength(2));
  });

  it('draws a circle by clicking the map', async () => {
    let body: unknown;
    server.use(
      http.post('*/api/geofences', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...depot, id: 'g3' }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderApp('/geofences', { user: admin });
    await user.click(await screen.findByRole('button', { name: 'New geofence' }));
    await user.type(screen.getByLabelText('Name'), 'Yard');
    fireEvent.click(screen.getByTestId('geofence-map'), { clientX: 400, clientY: 300 });
    await user.clear(screen.getByLabelText('Radius (m)'));
    await user.type(screen.getByLabelText('Radius (m)'), '150');
    await user.click(screen.getByRole('button', { name: 'Create geofence' }));
    await waitFor(() => expect(body).toMatchObject({ name: 'Yard', shape: { type: 'circle', radiusM: 150, center: { lat: expect.any(Number), lng: expect.any(Number) } } }));
  });

  it('draws a polygon corner by corner', async () => {
    let body: { shape: { coordinates: number[][] } } | undefined;
    server.use(
      http.post('*/api/geofences', async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json({ ...depot, id: 'g4' }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderApp('/geofences', { user: admin });
    await user.click(await screen.findByRole('button', { name: 'New geofence' }));
    await user.type(screen.getByLabelText('Name'), 'Field');
    await user.click(screen.getByLabelText('Polygon'));
    const map = screen.getByTestId('geofence-map');
    for (const [x, y] of [[100, 100], [300, 100], [300, 300], [100, 300]]) fireEvent.click(map, { clientX: x, clientY: y });
    await user.click(screen.getByRole('button', { name: 'Undo corner' }));
    expect(screen.getByText(/3 corners/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create geofence' }));
    await waitFor(() => expect(body?.shape.coordinates).toHaveLength(4)); // 3 corners, closed
    expect(body!.shape.coordinates[0]).toEqual(body!.shape.coordinates[3]);
  });

  it('explains why a geofence in use can not be deleted', async () => {
    server.use(http.delete('*/api/geofences/g1', () => HttpResponse.json({ code: 'CONFLICT', message: 'Used by alarm rules: Left depot. Delete or change them first.' }, { status: 409 })));
    const user = userEvent.setup();
    renderApp('/geofences', { user: admin });
    await user.click(await screen.findByRole('button', { name: 'Delete Depot' }));
    expect(await screen.findByText(/Used by alarm rules: Left depot/)).toBeInTheDocument();
  });
});

describe('profile location settings', () => {
  it('saves a reported location with trip detection', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post('*/api/device-profiles', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...profile(), ...body, id: 'p9' }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderApp('/profiles/new', { user: makeUser({ permissions: ['profile.read', 'profile.write'] }) });
    await user.type(await screen.findByLabelText('Name'), 'Tracker');
    await user.selectOptions(screen.getByLabelText('Location'), 'Reported by the device');
    await user.clear(screen.getByLabelText('Latitude key'));
    await user.type(screen.getByLabelText('Latitude key'), 'gps_lat');
    await user.click(screen.getByLabelText('Detect trips'));
    await user.type(screen.getByLabelText('Ignition key (optional)'), 'ign');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({
      locationMode: 'reported',
      locationKeys: { lat: 'gps_lat', lng: 'lng' },
      trips: { enabled: true, minSpeedKmh: 5, stopAfterS: 300, ignitionKey: 'ign' },
    });
  });
});
