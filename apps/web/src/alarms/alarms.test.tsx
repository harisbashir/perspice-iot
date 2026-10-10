import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { fakeSocket } from '@/test/fake-socket';
import { makeUser, renderApp } from '@/test/render';
import { server } from '@/test/server';
import { describeRule } from './describe';

const alarm = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  ruleId: 'r1',
  ruleName: 'Low fuel',
  type: 'threshold',
  severity: 'critical',
  status: 'active',
  device: { id: 'd1', name: 'Tower 17', profileId: 'p1' },
  customer: null,
  startedAt: Date.now() - 60_000,
  acknowledgedAt: null,
  acknowledgedBy: null,
  clearedAt: null,
  clearReason: null,
  value: { key: 'fuel_level', v: 12 },
  message: 'fuel_level is 12 (< 20)',
  ...over,
});

const operator = makeUser({ scopeType: 'customer', customerId: 'c1', permissions: ['alarm.read', 'alarm.ack', 'device.read', 'export.data'] });
const viewer = makeUser({ scopeType: 'customer', customerId: 'c1', permissions: ['alarm.read', 'device.read'] });

describe('alarms', () => {
  it('describes rules in words', () => {
    expect(describeRule({ type: 'threshold', condition: { key: 'fuel', op: '<', value: 20 }, clear: { margin: 2 } })).toBe('fuel below 20 (clears at 22)');
    expect(describeRule({ type: 'duration', condition: { key: 't', op: '>', value: 40, forS: 600 }, clear: { margin: 0 } })).toBe('t above 40 for 10 min');
    expect(describeRule({ type: 'state_match', condition: { key: 'door', values: [true, 'open'] }, clear: {} })).toBe('door is true or "open"');
    expect(describeRule({ type: 'no_data_key', condition: { key: 'f', forS: 7200 }, clear: {} })).toBe('No f for 2 h');
  });

  it('lists open alarms, filters, and refreshes live', async () => {
    const queries: string[] = [];
    let items = [alarm()];
    server.use(
      http.get('*/api/alarms', ({ request }) => {
        queries.push(new URL(request.url).search);
        return HttpResponse.json({ items, nextCursor: null });
      }),
    );
    const user = userEvent.setup();
    fakeSocket.reset();
    renderApp('/alarms', { user: operator });
    expect(await screen.findByRole('link', { name: 'Low fuel' })).toBeInTheDocument();
    expect(queries[0]).toContain('status=active%2Cacknowledged');
    await waitFor(() => expect(fakeSocket.emitted).toContainEqual(['subscribe:alarms', {}]));

    items = [alarm(), alarm({ id: 'a2', ruleName: 'Door open', severity: 'minor' })];
    fakeSocket.serverEmit('alarm', { change: 'raised', id: 'a2' });
    expect(await screen.findByRole('link', { name: 'Door open' })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Cleared' }));
    await waitFor(() => expect(queries.at(-1)).toContain('status=cleared'));
    await user.selectOptions(screen.getByLabelText('Severity'), 'Major');
    await waitFor(() => expect(queries.at(-1)).toContain('severity=major'));
  });

  it('acknowledges one alarm, or several selected', async () => {
    const acked: string[] = [];
    server.use(
      http.get('*/api/alarms', () => HttpResponse.json({ items: [alarm(), alarm({ id: 'a2', ruleName: 'Door open' })], nextCursor: null })),
      http.post('*/api/alarms/:id/ack', ({ params }) => {
        acked.push(params.id as string);
        return HttpResponse.json(alarm({ id: params.id, status: 'acknowledged' }));
      }),
    );
    const user = userEvent.setup();
    renderApp('/alarms', { user: operator });
    const row = (await screen.findByRole('link', { name: 'Low fuel' })).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expect(acked).toEqual(['a1']));

    await user.click(screen.getByRole('checkbox', { name: 'Select Low fuel on Tower 17' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Door open on Tower 17' }));
    await user.click(screen.getByRole('button', { name: 'Acknowledge 2 selected' }));
    await waitFor(() => expect(acked).toEqual(['a1', 'a1', 'a2']));
  });

  it('gives viewers no actions', async () => {
    server.use(http.get('*/api/alarms', () => HttpResponse.json({ items: [alarm()], nextCursor: null })));
    renderApp('/alarms', { user: viewer });
    await screen.findByRole('link', { name: 'Low fuel' });
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('shows the timeline and acknowledges with a comment', async () => {
    let body: unknown;
    server.use(
      http.get('*/api/alarms/a1', () =>
        HttpResponse.json({
          ...alarm(),
          timeline: [{ id: 'e1', type: 'raised', ts: Date.now() - 60_000, user: null, comment: null, data: { reason: null } }],
        }),
      ),
      http.post('*/api/alarms/a1/ack', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(alarm({ status: 'acknowledged' }));
      }),
    );
    const user = userEvent.setup();
    renderApp('/alarms/a1', { user: operator });
    expect(await screen.findByText('Raised')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Comment'), 'Driver on the way');
    await user.click(screen.getByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expect(body).toEqual({ comment: 'Driver on the way' }));
  });

  it('shows the unacknowledged count in the navigation', async () => {
    server.use(http.get('*/api/alarms/summary', () => HttpResponse.json({ critical: 2, major: 1, minor: 0, warning: 0, total: 3, unacknowledged: 3 })));
    renderApp('/', { user: operator });
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(await within(nav).findByLabelText('3 unacknowledged')).toHaveTextContent('3');
  });
});

describe('alarm rules', () => {
  const platform = makeUser({ permissions: ['alarm.read', 'alarm.rule.write', 'device.read', 'profile.read'] });
  const P = '11111111-1111-4111-8111-111111111111';
  const profile = { id: P, name: 'Telecom RMS', telemetrySchema: [{ key: 'fuel_level', label: 'Fuel level', unit: '%', type: 'number' }], commands: [] };

  it('creates a threshold rule for a profile with its condition previewed in words', async () => {
    let body: unknown;
    server.use(
      http.get('*/api/device-profiles', () => HttpResponse.json([profile])),
      http.post('*/api/alarm-rules', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...(body as object), id: 'r1', version: 1 }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderApp(`/alarm-rules?profileId=${P}`, { user: platform });
    await user.click(await screen.findByRole('button', { name: 'New rule' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Low fuel');
    await user.selectOptions(within(dialog).getByLabelText('Value'), 'Fuel level');
    await user.selectOptions(within(dialog).getByLabelText('Is'), 'below');
    await user.clear(within(dialog).getByLabelText('Threshold'));
    await user.type(within(dialog).getByLabelText('Threshold'), '20');
    await user.clear(within(dialog).getByLabelText('Clear margin'));
    await user.type(within(dialog).getByLabelText('Clear margin'), '2');
    expect(within(dialog).getByRole('status', { name: 'Rule preview' })).toHaveTextContent('Raises when: Fuel level below 20 (clears at 22)');
    await user.click(within(dialog).getByRole('button', { name: 'Create rule' }));
    await waitFor(() =>
      expect(body).toMatchObject({
        name: 'Low fuel',
        type: 'threshold',
        scope: { kind: 'profile', profileId: P },
        condition: { key: 'fuel_level', op: '<', value: 20 },
        clear: { margin: 2 },
        recipients: { roles: ['customer_admin'] },
        channels: ['inapp', 'email'],
      }),
    );
  });

  it('creates a geofence rule from the geofences the user can see', async () => {
    let body: unknown;
    const G = '33333333-3333-4333-8333-333333333333';
    server.use(
      http.get('*/api/device-profiles', () => HttpResponse.json([profile])),
      http.get('*/api/geofences', () =>
        HttpResponse.json([{ id: G, name: 'Depot', customerId: null, color: '#2563eb', shape: { type: 'circle', center: { lat: 51.5, lng: -0.12 }, radiusM: 500 }, createdAt: 0, updatedAt: 0 }]),
      ),
      http.post('*/api/alarm-rules', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...(body as object), id: 'r2', version: 1 }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderApp(`/alarm-rules?profileId=${P}`, { user: platform });
    await user.click(await screen.findByRole('button', { name: 'New rule' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Left depot');
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'Device leaves (or enters) a geofence');
    expect(within(dialog).queryByLabelText('Value')).not.toBeInTheDocument();
    await user.selectOptions(await within(dialog).findByLabelText('Geofence'), 'Depot (platform-wide)');
    expect(within(dialog).getByRole('status', { name: 'Rule preview' })).toHaveTextContent('Raises when: Device leaves the geofence (clears 20 m back)');
    await user.click(within(dialog).getByRole('button', { name: 'Create rule' }));
    await waitFor(() => expect(body).toMatchObject({ type: 'geofence', condition: { geofenceId: G, trigger: 'outside' }, clear: { marginM: 20 } }));
  });

  it('creates a maintenance rule from run hours or days', async () => {
    let body: unknown;
    const generator = { ...profile, calculated: [{ key: 'run_s', label: 'Generator run time', kind: 'runtime', source: 'gen_running', gapCapS: 900 }] };
    server.use(
      http.get('*/api/device-profiles', () => HttpResponse.json([generator])),
      http.post('*/api/alarm-rules', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...(body as object), id: 'r3', version: 1 }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderApp(`/alarm-rules?profileId=${P}`, { user: platform });
    await user.click(await screen.findByRole('button', { name: 'New rule' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Generator service');
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'Service due (run hours or days)');
    expect(within(dialog).queryByLabelText('Value')).not.toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText('Run time key'), 'run_s');
    await user.type(within(dialog).getByLabelText('Every (run hours)'), '250');
    const remind = within(dialog).getByLabelText('Remind at (% of the interval)');
    await user.clear(remind);
    await user.type(remind, '90');
    expect(within(dialog).getByRole('status', { name: 'Rule preview' })).toHaveTextContent('Raises when: Service every 250 h of Generator run time or 180 days (reminds at 90%)');
    await user.click(within(dialog).getByRole('button', { name: 'Create rule' }));
    await waitFor(() => expect(body).toMatchObject({ type: 'maintenance_due', condition: { runtimeKey: 'run_s', everyHours: 250, everyDays: 180, remindAtPct: 90 } }));
  });

  it('keeps inherited profile rules read-only for customers', async () => {
    server.use(
      http.get('*/api/alarm-rules', () =>
        HttpResponse.json([
          { id: 'r1', name: 'Low fuel', type: 'threshold', severity: 'major', scope: { kind: 'profile', profileId: 'p1' }, condition: { key: 'fuel_level', op: '<', value: 20 }, clear: { margin: 0 }, enabled: true, recipients: { roles: [], userIds: [], groupIds: [] }, channels: [], cooldownS: 300, schedule: null, version: 1 },
        ]),
      ),
    );
    renderApp('/alarm-rules', { user: makeUser({ scopeType: 'customer', customerId: 'c1', permissions: ['alarm.read', 'alarm.rule.write', 'device.read'] }) });
    expect(await screen.findByText('fuel_level below 20')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Low fuel' })).toBeNull();
    expect(screen.getByRole('button', { name: 'New rule' })).toBeInTheDocument();
  });
});
