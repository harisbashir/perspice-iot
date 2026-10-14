import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { makeUser, renderApp } from '@/test/render';
import { server } from '@/test/server';
import { formatBytes } from './SystemPage';

const now = Date.now();
const status = {
  version: '0.4.0',
  processes: [
    { role: 'api', instance: 'api-1', version: '0.4.0', startedAt: now - 7_200_000, lastSeen: now },
    { role: 'ingest', instance: 'ingest-1', version: '0.4.0', startedAt: now - 7_200_000, lastSeen: now - 120_000 },
  ],
  expectedRoles: ['api', 'ingest', 'rules', 'scheduler', 'renderer'],
  messagesPerMinute: 59_400,
  connectedDevices: 9_980,
  websocketClients: 12,
  queues: { email: { waiting: 0, active: 0, failed: 2, delayed: 0 } },
  database: { sizeBytes: 3 * 1024 ** 3 },
  storage: { driver: 'local', usedBytes: 10 * 1024 ** 3, freeBytes: 90 * 1024 ** 3 },
  backup: { latest: null, lastError: null, running: false },
  maintenance: false,
};
const backups = {
  latest: { file: 'perspice-backup-0.4.0-20261009T020000Z.pbk', size: 52_428_800, sha256: 'x', version: '0.4.0', createdAt: now },
  running: false,
  lastError: null,
  schedule: { enabled: true, time: '02:00', timezone: 'UTC' },
  nextRunAt: now + 3_600_000,
  configured: true,
};
const owner = makeUser({ roleKey: 'super_admin', totpEnabled: true, permissions: ['system.settings', 'backup.manage'] });

describe('System page', () => {
  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(52_428_800)).toBe('50 MB');
  });

  it('shows processes, missing roles, load and queues', async () => {
    server.use(
      http.get('*/api/system/status', () => HttpResponse.json(status)),
      http.get('*/api/system/backups', () => HttpResponse.json(backups)),
      http.get('*/api/system/restore', () => HttpResponse.json({ state: 'idle', message: null, startedAt: null, finishedAt: null })),
    );
    renderApp('/system', { user: owner });
    expect(await screen.findByText('59,400')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Not running: rules, scheduler, renderer');
    expect(screen.getByText('silent')).toBeInTheDocument();
    expect(screen.getByText('3.0 GB')).toBeInTheDocument();
    expect(await screen.findByText('perspice-backup-0.4.0-20261009T020000Z.pbk')).toBeInTheDocument();
  });

  it('backs up now, and restores an uploaded file after confirmation', async () => {
    let started = false;
    // (jsdom's File isn't a fetch body type, so only the request itself is checked, not its bytes.)
    let uploaded: { type: string | null; size: number } | null = null;
    let restoreState = { state: 'idle', message: null as string | null, startedAt: null, finishedAt: null };
    server.use(
      http.get('*/api/system/status', () => HttpResponse.json(status)),
      http.get('*/api/system/backups', () => HttpResponse.json({ ...backups, running: started })),
      http.post('*/api/system/backups', () => {
        started = true;
        return HttpResponse.json({ ...backups, running: true }, { status: 202 });
      }),
      http.get('*/api/system/restore', () => HttpResponse.json(restoreState)),
      http.post('*/api/system/restore', async ({ request }) => {
        uploaded = { type: request.headers.get('content-type'), size: (await request.arrayBuffer()).byteLength };
        restoreState = { ...restoreState, state: 'restoring', message: 'Restoring the database' };
        return HttpResponse.json(restoreState, { status: 202 });
      }),
    );
    const user = userEvent.setup();
    renderApp('/system', { user: owner });
    await user.click(await screen.findByRole('button', { name: 'Back up now' }));
    await waitFor(() => expect(started).toBe(true));
    expect(await screen.findByRole('button', { name: 'Backing up…' })).toBeDisabled();

    await user.upload(screen.getByLabelText('Backup file'), new File(['PSPBK1abc'], 'b.pbk'));
    expect(screen.getByRole('alertdialog', { name: 'Confirm restore' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(uploaded).toMatchObject({ type: 'application/octet-stream' }));
    expect(await screen.findByText('Restoring the database')).toBeInTheDocument();
  });

  it('shows the maintenance banner when the API is in maintenance, and clears it when back', async () => {
    let maintenance = true;
    server.use(
      http.get('*/api/system/status', () => (maintenance ? HttpResponse.json({ code: 'MAINTENANCE', message: 'Restoring' }, { status: 503 }) : HttpResponse.json(status))),
      http.get('*/api/public/maintenance', () => HttpResponse.json({ maintenance, since: 1 })),
      http.get('*/api/system/backups', () => HttpResponse.json(backups)),
      http.get('*/api/system/restore', () => HttpResponse.json({ state: 'restoring', message: 'x', startedAt: 1, finishedAt: null })),
    );
    renderApp('/system', { user: owner });
    expect(await screen.findByText(/being restored from a backup/)).toBeInTheDocument();
    maintenance = false;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5200));
    });
    await waitFor(() => expect(screen.queryByText(/being restored from a backup/)).toBeNull());
  }, 15_000);

  it('offers the newer release, runs the end-to-end check and sets up push', async () => {
    let pushKey: string | null = null;
    server.use(
      http.get('*/api/system/status', () => HttpResponse.json(status)),
      http.get('*/api/system/backups', () => HttpResponse.json(backups)),
      http.get('*/api/system/backups/restore', () => HttpResponse.json({ running: false })),
      http.get('*/api/system/update', () => HttpResponse.json({ current: '1.0.2', latest: '1.0.3', updateAvailable: true, url: 'https://github.com/x/y/releases/tag/v1.0.3' })),
      http.post('*/api/system/roundtrip', () => HttpResponse.json({ ok: true, ms: 84, message: 'ok' }, { status: 201 })),
      http.get('*/api/push/public-key', () => HttpResponse.json({ publicKey: pushKey, subscriptions: 0 })),
      http.post('*/api/system/push', () => {
        pushKey = 'BKey';
        return HttpResponse.json({ publicKey: pushKey }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderApp('/system', { user: owner });
    expect(await screen.findByText(/Version 1.0.3 is available/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('sudo perspice update --version 1.0.3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run check' }));
    expect(await screen.findByText('Working: stored in 84 ms')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Set up push notifications' }));
    expect(await screen.findByText(/Set up: people can turn on push/)).toBeInTheDocument();
  });
});
