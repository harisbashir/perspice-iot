import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { makeUser, renderApp } from '@/test/render';
import { server } from '@/test/server';
import { cadenceText } from './ReportSchedulesPage';

const me = makeUser({ id: 'u1', scopeType: 'customer', customerId: 'c1', permissions: ['report.schedule', 'export.data', 'device.read', 'user.read'] });

describe('scheduled reports', () => {
  it('describes cadences', () => {
    expect(cadenceText({ kind: 'weekly', day: 5, time: '09:00' }, 'UTC')).toBe('Every Friday at 09:00 (UTC)');
    expect(cadenceText({ kind: 'monthly', day: 1, time: '06:00' }, 'Asia/Karachi')).toBe('Monthly on day 1 at 06:00 (Asia/Karachi)');
  });

  it('creates a weekly telemetry export for chosen recipients', async () => {
    let created: Record<string, unknown> | undefined;
    server.use(
      http.get('*/api/report-schedules', () => HttpResponse.json([])),
      http.get('*/api/devices', () => HttpResponse.json({ items: [{ id: 'd1', name: 'Tower 5', profileId: 'p1', status: 'online' }], nextCursor: null })),
      http.get('*/api/device-profiles', () => HttpResponse.json([{ id: 'p1', name: 'RMS', telemetrySchema: [{ key: 'fuel_level', label: 'Fuel level', type: 'number' }], commands: [] }])),
      http.get('*/api/users', () =>
        HttpResponse.json([
          { id: 'u1', name: 'Me', email: 'me@x', status: 'active' },
          { id: 'u2', name: 'Colleague', email: 'col@x', status: 'active' },
        ]),
      ),
      http.post('*/api/report-schedules', async ({ request }) => {
        created = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...created, id: 's1', ownerId: 'u1', nextRunAt: null, lastRun: null }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderApp('/reports', { user: me });
    await user.click(await screen.findByRole('button', { name: 'New schedule' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Weekly fuel');
    await user.selectOptions(within(dialog).getByLabelText('Report'), 'telemetry');
    await user.selectOptions(await within(dialog).findByLabelText('Device'), 'd1');
    await user.click(await within(dialog).findByRole('checkbox', { name: 'Fuel level' }));
    await user.selectOptions(within(dialog).getByLabelText('Repeat'), 'weekly');
    await user.selectOptions(within(dialog).getByLabelText('On'), 'Friday');
    await user.selectOptions(within(dialog).getByLabelText('Timezone'), 'UTC');
    await user.click(await within(dialog).findByRole('checkbox', { name: /Colleague/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Create schedule' }));
    await waitFor(() =>
      expect(created).toEqual({
        name: 'Weekly fuel',
        target: { kind: 'telemetry', deviceId: 'd1', keys: ['fuel_level'], format: 'csv' },
        timewindow: { kind: 'relative', lastMs: 86_400_000 },
        cadence: { kind: 'weekly', day: 5, time: '07:00' },
        timezone: 'UTC',
        recipients: ['u1', 'u2'],
        enabled: true,
      }),
    );
  });

  it('lists schedules with their last run and runs one now', async () => {
    let ran = false;
    server.use(
      http.get('*/api/report-schedules', () =>
        HttpResponse.json([
          { id: 's1', name: 'Daily site', cadence: { kind: 'daily', time: '07:00' }, timezone: 'UTC', nextRunAt: Date.now() + 3_600_000, lastRun: { at: Date.now(), status: 'skipped', message: 'The owner can no longer see this dashboard or device', jobId: null } },
        ]),
      ),
      http.post('*/api/report-schedules/s1/run', () => {
        ran = true;
        return HttpResponse.json({}, { status: 202 });
      }),
    );
    const user = userEvent.setup();
    renderApp('/reports', { user: me });
    expect(await screen.findByText('Daily at 07:00 (UTC)')).toBeInTheDocument();
    expect(screen.getByText('skipped')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run Daily site now' }));
    await waitFor(() => expect(ran).toBe(true));
  });
});
