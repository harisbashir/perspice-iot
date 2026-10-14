import type { DashboardDefinition, DashboardViewDto, DeviceProfileDto } from '@perspice/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { CloneDialog, unmatchedKeys } from '@/pages/dashboards/KeyMappingDialog';
import { makeUser, renderApp } from '@/test/render';
import { server } from '@/test/server';

const PROFILE_ID = '7d1c6b4e-6a8a-4bd1-9a52-2c6f2a1a8a11';
const profile = {
  id: PROFILE_ID,
  name: 'Telecom RMS',
  description: null,
  telemetrySchema: [
    { key: 'fuel_level', label: 'Fuel', unit: '%', type: 'number', decimals: 1 },
    { key: 'batt_v', label: 'Battery', unit: 'V', type: 'number' },
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
  defaultDashboardTemplateId: 't1',
  createdAt: '',
  updatedAt: '',
} as DeviceProfileDto;

const definition = (): DashboardDefinition => ({
  states: [
    {
      id: 'main',
      name: 'Main',
      layout: [{ i: 'fuel', x: 0, y: 0, w: 3, h: 3 }],
      widgets: [{ id: 'fuel', type: 'value-card', title: 'Fuel', datasource: { kind: 'currentDevice', keys: ['fuel_level'] }, settings: {} }],
    },
  ],
  settings: { timewindow: { kind: 'relative', lastMs: 86_400_000 }, refreshS: 0 },
});

const device = {
  id: 'd1',
  name: 'Tower 17',
  profileId: PROFILE_ID,
  customerId: 'c1',
  groupId: null,
  tags: [],
  status: 'online',
  lastSeen: 1,
  firmwareVersion: null,
  location: null,
  offlineTimeoutS: null,
  deadTimeoutS: null,
  attributes: { client: {}, server: {}, shared: {} },
  latest: {},
  createdAt: '',
  updatedAt: '',
};

const common = [
  http.get(`*/api/device-profiles/${PROFILE_ID}`, () => HttpResponse.json(profile)),
  http.get('*/api/device-profiles', () => HttpResponse.json([profile])),
  http.post('*/api/dashboards/data', () => HttpResponse.json({ results: {} })),
];

describe('dashboard builder', () => {
  it('adds a widget from the palette, edits it and saves a valid definition', async () => {
    let saved: { definition: DashboardDefinition } | undefined;
    server.use(
      ...common,
      http.get('*/api/dashboard-templates/t1', () =>
        HttpResponse.json({ id: 't1', name: 'RMS', kind: 'device', profileId: PROFILE_ID, definition: definition(), version: 3, builtIn: false, createdAt: '', updatedAt: '' }),
      ),
      http.get('*/api/devices', () => HttpResponse.json({ items: [device], nextCursor: null })),
      http.patch('*/api/dashboard-templates/t1', async ({ request }) => {
        saved = (await request.json()) as { definition: DashboardDefinition };
        return HttpResponse.json({ id: 't1', name: 'RMS', kind: 'device', profileId: PROFILE_ID, definition: saved.definition, version: 4, builtIn: false, createdAt: '', updatedAt: '' });
      }),
    );
    const user = userEvent.setup();
    renderApp('/dashboards/t1/edit', { user: makeUser({ permissions: ['dashboard.edit', 'device.read', 'profile.read'] }) });

    expect(await screen.findByText(/version 3/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Add widget' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Radial gauge/ }));
    // The new widget is selected; its settings panel is open.
    const panel = screen.getByRole('complementary', { name: 'Widget settings' });
    await user.clear(within(panel).getByLabelText('Title'));
    await user.type(within(panel).getByLabelText('Title'), 'Fuel gauge');
    expect(await screen.findByRole('region', { name: 'Fuel gauge' })).toBeInTheDocument();
    await user.clear(within(panel).getByLabelText('Maximum'));
    await user.type(within(panel).getByLabelText('Maximum'), '200');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saved).toBeDefined());
    const widgets = saved!.definition.states[0]!.widgets;
    expect(widgets).toHaveLength(2);
    expect(widgets[1]).toMatchObject({ type: 'radial-gauge', title: 'Fuel gauge', datasource: { kind: 'currentDevice', keys: ['fuel_level'] }, settings: { max: 200 } });
    expect(saved!.definition.states[0]!.layout).toHaveLength(2);
  });

  it('previews with sample data when no device has the profile, and on request when one does', async () => {
    const sent: unknown[] = [];
    let devices: (typeof device)[] = [];
    server.use(
      ...common,
      http.post('*/api/dashboards/data', async ({ request }) => {
        sent.push(...((await request.json()) as { requests: unknown[] }).requests);
        return HttpResponse.json({ results: {} });
      }),
      http.get('*/api/dashboard-templates/t1', () =>
        HttpResponse.json({ id: 't1', name: 'RMS', kind: 'device', profileId: PROFILE_ID, definition: definition(), version: 3, builtIn: false, createdAt: '', updatedAt: '' }),
      ),
      http.get('*/api/devices', () => HttpResponse.json({ items: devices, nextCursor: null })),
    );
    const { unmount } = renderApp('/dashboards/t1/edit', { user: makeUser({ permissions: ['dashboard.edit', 'device.read', 'profile.read'] }) });
    expect(await screen.findByRole('status')).toHaveTextContent(/sample data/i);
    // The fuel card shows a made-up percentage instead of an error, and nothing was asked of the server for it.
    const card = await screen.findByRole('region', { name: 'Fuel' });
    await waitFor(() => expect(card).toHaveTextContent(/\d+(\.\d)?\s*%/));
    expect(card).not.toHaveTextContent(/needs the dashboard/);
    expect(sent).toEqual([]);
    unmount();

    devices = [device];
    const user = userEvent.setup();
    renderApp('/dashboards/t1/edit', { user: makeUser({ permissions: ['dashboard.edit', 'device.read', 'profile.read'] }) });
    const picker = await screen.findByLabelText('Preview with');
    await waitFor(() => expect(picker).toHaveValue('d1'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await user.selectOptions(picker, 'sample');
    expect(await screen.findByRole('status')).toHaveTextContent(/sample data/i);
  });

  it('the clone dialog asks to map keys the target profile lacks', async () => {
    const other = { ...profile, id: 'p2', name: 'Other', telemetrySchema: [{ key: 'tank_pct', label: 'Tank', type: 'number' }] } as DeviceProfileDto;
    expect(unmatchedKeys(definition(), other)).toEqual(['fuel_level']);
    let body: unknown;
    render(
      <CloneDialog
        open
        onOpenChange={() => undefined}
        source={{ name: 'RMS', kind: 'device', profileId: PROFILE_ID, definition: definition() }}
        profiles={[profile, other]}
        onClone={async (b) => {
          body = b;
        }}
      />,
    );
    expect(screen.queryByRole('group', { name: 'Key mapping' })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Profile'), 'p2');
    await userEvent.selectOptions(screen.getByLabelText('Map “fuel_level” to'), 'tank_pct');
    await userEvent.click(screen.getByRole('button', { name: 'Clone' }));
    expect(body).toEqual({ name: 'RMS (copy)', profileId: 'p2', keyMapping: { fuel_level: 'tank_pct' } });
  });
});

describe('customer customisation', () => {
  const view = (o: Partial<DashboardViewDto> = {}): DashboardViewDto => ({
    instanceId: 'i1',
    templateId: 't1',
    templateName: 'RMS',
    templateVersion: 2,
    overridden: true,
    baseVersion: 1,
    outdated: true,
    definition: definition(),
    ...o,
  });
  const customerAdmin = makeUser({ scopeType: 'customer', customerId: 'c1', roleKey: 'customer_admin', permissions: ['device.read', 'dashboard.customize', 'profile.read'] });

  it('shows the drift banner and re-syncs with the template', async () => {
    let resynced = false;
    server.use(
      ...common,
      http.get('*/api/devices/d1', () => HttpResponse.json(device)),
      http.get('*/api/dashboards/device/d1', () => HttpResponse.json(view())),
      http.delete('*/api/dashboard-instances/i1/override', () => {
        resynced = true;
        return HttpResponse.json(view({ overridden: false, baseVersion: null, outdated: false }));
      }),
    );
    const user = userEvent.setup();
    renderApp('/devices/d1', { user: customerAdmin });
    expect(await screen.findByText(/has changed since this dashboard was customised/)).toBeInTheDocument();
    // The toolbar is part of the lazily loaded dashboard view.
    await user.click(await screen.findByRole('button', { name: 'Re-sync with template' }));
    expect(screen.queryByRole('link', { name: 'Edit template' })).not.toBeInTheDocument();
    await waitFor(() => expect(resynced).toBe(true));
    expect(await screen.findByRole('link', { name: 'Customise' })).toBeInTheDocument();
    expect(screen.queryByText(/has changed since/)).not.toBeInTheDocument();
  });

  it('customising saves an override for the organisation', async () => {
    let put: { definition: DashboardDefinition } | undefined;
    server.use(
      ...common,
      http.get('*/api/devices/d1', () => HttpResponse.json(device)),
      http.get('*/api/dashboards/device/d1', () => HttpResponse.json(view({ overridden: false, baseVersion: null, outdated: false }))),
      http.put('*/api/dashboard-instances/i1/override', async ({ request }) => {
        put = (await request.json()) as { definition: DashboardDefinition };
        return HttpResponse.json(view({ definition: put.definition, outdated: false, baseVersion: 2 }));
      }),
    );
    const user = userEvent.setup();
    const { router } = renderApp('/devices/d1', { user: customerAdmin });
    await user.click(await screen.findByRole('link', { name: 'Customise' }));
    expect(await screen.findByRole('heading', { name: 'Customise dashboard' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Select Fuel' }));
    const panel = screen.getByRole('complementary', { name: 'Widget settings' });
    await user.clear(within(panel).getByLabelText('Title'));
    await user.type(within(panel).getByLabelText('Title'), 'Diesel');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put?.definition.states[0]!.widgets[0]!.title).toBe('Diesel'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/devices/d1'));
  });
});
