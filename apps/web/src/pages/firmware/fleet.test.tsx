import type { BulkResult, DeviceDto, FirmwareDto, ImportReport, OtaDeviceDto, OtaJobDto } from '@perspice/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { makeUser, renderApp } from '@/test/render';
import { server } from '@/test/server';

const platform = makeUser({ permissions: ['device.read', 'device.write', 'device.command', 'firmware.manage', 'profile.read', 'customer.read'] });
const customerAdmin = makeUser({
  scopeType: 'customer',
  customerId: 'c1',
  roleKey: 'customer_admin',
  permissions: ['device.read', 'device.write', 'device.command', 'device.claim', 'profile.read'],
});

const profiles = [{ id: 'p1', name: 'Pump' }];
const fw: FirmwareDto = { id: 'f1', profileId: 'p1', version: '1.2.0', size: 524288, sha256: 'ab'.repeat(32), notes: '', createdAt: Date.now() };
const counts = { pending: 1, sent: 1, downloading: 0, verifying: 0, applied: 2, failed: 1, skipped: 0 };
const job = (o: Partial<OtaJobDto> = {}): OtaJobDto => ({
  id: 'j1',
  firmware: { id: 'f1', version: '1.2.0', profileId: 'p1' },
  status: 'running',
  target: { kind: 'profile', customerId: null, tags: [] },
  batchSize: 10,
  maxFailurePct: 20,
  timeoutMin: 30,
  counts,
  haltReason: null,
  createdAt: Date.now(),
  finishedAt: null,
  ...o,
});
const dev = (id: string, name: string): DeviceDto => ({
  id,
  name,
  profileId: 'p1',
  customerId: 'c1',
  groupId: null,
  tags: [],
  status: 'online',
  lastSeen: Date.now(),
  firmwareVersion: '1.0.0',
  serial: null,
  provisionedAt: null,
  location: null,
  offlineTimeoutS: null,
  deadTimeoutS: null,
  attributes: { client: {}, server: {}, shared: {} },
  latest: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

describe('firmware', () => {
  it('uploads an image with its profile and version', async () => {
    let upload: { query: URLSearchParams; type: string | null } | null = null;
    server.use(
      http.get('*/api/device-profiles', () => HttpResponse.json(profiles)),
      http.post('*/api/firmware', ({ request }) => {
        upload = { query: new URL(request.url).searchParams, type: request.headers.get('content-type') };
        return HttpResponse.json(fw, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderApp('/firmware', { user: platform });
    await user.click(await screen.findByRole('button', { name: /Upload firmware/ }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Profile'), 'p1');
    await user.type(within(dialog).getByLabelText('Version'), '1.2.0');
    await user.upload(within(dialog).getByLabelText('Image (.bin)'), new File([new Uint8Array(100)], 'app.bin'));
    await user.click(within(dialog).getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(upload).not.toBeNull());
    expect(upload!.query.get('profileId')).toBe('p1');
    expect(upload!.query.get('version')).toBe('1.2.0');
    expect(upload!.type).toBe('application/octet-stream');
    // The bytes themselves aren't checked: Node's fetch can't read jsdom's File (the server tests cover the upload).
  });

  it('deploys a version and opens the update', async () => {
    let body: unknown = null;
    server.use(
      http.get('*/api/device-profiles', () => HttpResponse.json(profiles)),
      http.get('*/api/firmware', () => HttpResponse.json([fw])),
      http.post('*/api/ota-jobs', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(job(), { status: 201 });
      }),
      http.get('*/api/ota-jobs/j1', () => HttpResponse.json(job())),
      http.get('*/api/ota-jobs/j1/devices', () => HttpResponse.json([])),
    );
    const user = userEvent.setup();
    renderApp('/firmware', { user: platform });
    await user.click(within(await screen.findByTestId('firmware-1.2.0')).getByRole('button', { name: 'Deploy' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Only devices with these tags'), 'north, pilot');
    await user.clear(within(dialog).getByLabelText('Batch size'));
    await user.type(within(dialog).getByLabelText('Batch size'), '5');
    await user.click(within(dialog).getByRole('button', { name: 'Start update' }));
    expect(await screen.findByRole('heading', { name: 'Update to Pump 1.2.0' })).toBeInTheDocument();
    expect(body).toEqual({ firmwareId: 'f1', target: { kind: 'profile', customerId: null, tags: ['north', 'pilot'] }, batchSize: 5, maxFailurePct: 20, timeoutMin: 30 });
  });

  it('shows a halted update with its reason, per-device states, and cancels it', async () => {
    let cancelled = false;
    const devices: OtaDeviceDto[] = [
      { deviceId: 'd1', deviceName: 'Pump 1', state: 'failed', pct: null, error: 'checksum mismatch', updatedAt: Date.now() },
      { deviceId: 'd2', deviceName: 'Pump 2', state: 'downloading', pct: 40, error: null, updatedAt: Date.now() },
    ];
    server.use(
      http.get('*/api/ota-jobs/j1', () => HttpResponse.json(job({ status: cancelled ? 'cancelled' : 'halted', haltReason: '2 of 2 devices failed (more than 20%)' }))),
      http.get('*/api/ota-jobs/j1/devices', () => HttpResponse.json(devices)),
      http.post('*/api/ota-jobs/j1/cancel', () => {
        cancelled = true;
        return HttpResponse.json(job({ status: 'cancelled' }));
      }),
    );
    const user = userEvent.setup();
    renderApp('/ota-jobs/j1', { user: platform });
    expect(await screen.findByRole('alert')).toHaveTextContent('Halted: 2 of 2 devices failed (more than 20%)');
    expect(within(await screen.findByTestId('ota-device-d1')).getByText('checksum mismatch')).toBeInTheDocument();
    expect(within(screen.getByTestId('ota-device-d2')).getByText('Downloading 40%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '60');
    await user.click(screen.getByRole('button', { name: 'Cancel update' }));
    await waitFor(() => expect(cancelled).toBe(true));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel update' })).not.toBeInTheDocument());
  });

  it("shows a device's updates on its Firmware tab", async () => {
    server.use(
      http.get('*/api/devices/d1', () => HttpResponse.json(dev('d1', 'Pump 1'))),
      http.get('*/api/device-profiles/p1', () => HttpResponse.json({ id: 'p1', name: 'Pump', telemetrySchema: [], commands: [], locationMode: 'none', trips: { enabled: false } })),
      http.get('*/api/devices/d1/ota', () => HttpResponse.json([{ jobId: 'j1', version: '1.2.0', jobStatus: 'running', state: 'verifying', pct: 100, error: null, updatedAt: Date.now() }])),
    );
    const user = userEvent.setup();
    renderApp('/devices/d1', { user: customerAdmin });
    await user.click(await screen.findByRole('tab', { name: 'Firmware' }));
    expect(await screen.findByText('Verifying')).toBeInTheDocument();
    expect(screen.getByText('1.0.0')).toBeInTheDocument();
  });
});

describe('bulk actions', () => {
  it('adds tags to the selected devices and reports the ones that failed', async () => {
    let body: unknown = null;
    server.use(
      http.get('*/api/devices', () => HttpResponse.json({ items: [dev('d1', 'Pump 1'), dev('d2', 'Pump 2'), dev('d3', 'Pump 3')], nextCursor: null })),
      http.post('*/api/devices/bulk', async ({ request }) => {
        body = await request.json();
        const res: BulkResult = { ok: 1, results: [{ deviceId: 'd1', ok: true }, { deviceId: 'd3', ok: false, error: 'Not found' }] };
        return HttpResponse.json(res);
      }),
    );
    const user = userEvent.setup();
    renderApp('/devices', { user: customerAdmin });
    await user.click(await screen.findByLabelText('Select Pump 1'));
    await user.click(screen.getByLabelText('Select Pump 3'));
    const bar = screen.getByRole('toolbar', { name: 'Selected devices' });
    expect(bar).toHaveTextContent('2 devices selected');
    await user.click(within(bar).getByRole('button', { name: 'Tags' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Add tags'), 'north, pilot');
    await user.click(within(dialog).getByRole('button', { name: 'Apply to 2' }));
    expect(await within(dialog).findByTestId('bulk-result')).toHaveTextContent('1 of 2 done; 1 failed');
    expect(body).toEqual({ deviceIds: ['d1', 'd3'], action: { kind: 'tags', add: ['north', 'pilot'], remove: [] } });
  });

  it('select all, then delete after confirming', async () => {
    let body: { deviceIds: string[]; action: { kind: string } } | null = null;
    server.use(
      http.get('*/api/devices', () => HttpResponse.json({ items: [dev('d1', 'Pump 1'), dev('d2', 'Pump 2')], nextCursor: null })),
      http.post('*/api/devices/bulk', async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json({ ok: 2, results: [] });
      }),
    );
    const user = userEvent.setup();
    renderApp('/devices', { user: customerAdmin });
    await user.click(await screen.findByLabelText('Select all devices'));
    await user.click(within(screen.getByRole('toolbar', { name: 'Selected devices' })).getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Delete these 2 devices');
    await user.click(within(dialog).getByRole('button', { name: 'Delete to 2' }));
    await waitFor(() => expect(body?.action).toEqual({ kind: 'delete' }));
    await waitFor(() => expect(screen.queryByRole('toolbar', { name: 'Selected devices' })).not.toBeInTheDocument());
  });
});

describe('import', () => {
  it('checks the file, then imports and offers the credentials once', async () => {
    const calls: string[] = [];
    let bad = true;
    server.use(
      http.post('*/api/devices/import', ({ request }) => {
        const dry = new URL(request.url).searchParams.get('dryRun') === 'true';
        calls.push(dry ? 'check' : 'import');
        if (dry && bad) return HttpResponse.json({ ok: false, rows: 2, errors: [{ row: 2, field: 'profile', message: 'No such profile' }] } satisfies ImportReport);
        if (dry) return HttpResponse.json({ ok: true, rows: 2, errors: [] } satisfies ImportReport);
        return HttpResponse.json({
          ok: true,
          rows: 2,
          errors: [],
          created: [
            { id: 'd1', name: 'A', token: 'pdt_a', claimCode: null },
            { id: 'd2', name: 'B', token: 'pdt_b', claimCode: 'ABCD-EFGH-JKMN' },
          ],
        } satisfies ImportReport);
      }),
    );
    const saved: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download);
    });
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    const user = userEvent.setup();
    renderApp('/devices', { user: platform });
    await user.click(await screen.findByRole('button', { name: /Import/ }));
    const dialog = await screen.findByRole('dialog');
    await user.upload(within(dialog).getByLabelText('CSV file'), new File(['name,profile\nA,Pump\nB,Nope'], 'devices.csv', { type: 'text/csv' }));
    await user.click(within(dialog).getByRole('button', { name: 'Check' }));
    expect(await within(dialog).findByTestId('import-report')).toHaveTextContent('Row 2, profile: No such profile');
    expect(within(dialog).getByRole('button', { name: 'Import' })).toBeDisabled();
    bad = false;
    await user.click(within(dialog).getByRole('button', { name: 'Check' }));
    expect(await within(dialog).findByText('2 devices are ready to import.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Import' }));
    expect(await within(dialog).findByTestId('import-created')).toHaveTextContent('2 devices created.');
    await user.click(within(dialog).getByRole('button', { name: 'Download credentials (CSV)' }));
    expect(saved).toEqual(['device-credentials.csv']);
    expect(calls).toEqual(['check', 'check', 'import']);
    click.mockRestore();
  });
});

describe('claiming', () => {
  it('a customer admin adds a device with its claim code', async () => {
    let body: unknown = null;
    server.use(
      http.post('*/api/devices/claim', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(dev('d9', 'Boiler'));
      }),
      http.get('*/api/devices/d9', () => HttpResponse.json(dev('d9', 'Boiler'))),
    );
    const user = userEvent.setup();
    const { router } = renderApp('/devices', { user: customerAdmin });
    expect(screen.queryByRole('button', { name: /Import/ })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /Add with claim code/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Claim code'), 'abcd-efgh-jkmn');
    await user.type(within(dialog).getByLabelText('Name'), 'Boiler');
    await user.click(within(dialog).getByRole('button', { name: 'Add device' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/devices/d9'));
    expect(body).toEqual({ code: 'abcd-efgh-jkmn', name: 'Boiler' });
  });
});
