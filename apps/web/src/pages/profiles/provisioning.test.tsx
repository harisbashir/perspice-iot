import type { DeviceProfileDto, ProvisioningKeyDto } from '@perspice/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { makeUser, renderApp } from '@/test/render';
import { server } from '@/test/server';

const admin = makeUser({ permissions: ['profile.read', 'profile.write', 'customer.read'] });
const profile = {
  id: 'p1',
  name: 'Tank sensor',
  description: null,
  telemetrySchema: [],
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
} as DeviceProfileDto;
const key = (o: Partial<ProvisioningKeyDto> = {}): ProvisioningKeyDto => ({
  id: 'k1',
  profileId: 'p1',
  name: 'Line 1',
  mode: 'create',
  customerId: null,
  groupId: null,
  tags: [],
  issueClaimCodes: false,
  allowReprovision: false,
  maxDevices: 500,
  provisionedCount: 12,
  expiresAt: null,
  revokedAt: null,
  lastUsedAt: null,
  createdAt: 0,
  ...o,
});

describe('provisioning keys', () => {
  it('creates a key, shows its secret once with the firmware settings, and revokes keys', async () => {
    let keys = [key()];
    let sent: Record<string, unknown> | undefined;
    let revoked = '';
    server.use(
      http.get('*/api/device-profiles/p1', () => HttpResponse.json(profile)),
      http.get('*/api/customers', () => HttpResponse.json([{ id: 'c1', name: 'Acme', slug: 'acme', status: 'active' }])),
      http.get('*/api/device-profiles/p1/provisioning-keys', () => HttpResponse.json(keys)),
      http.post('*/api/device-profiles/p1/provisioning-keys', async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        keys = [key({ id: 'k2', name: 'Line 2', maxDevices: null, provisionedCount: 0 }), ...keys];
        return HttpResponse.json({ ...keys[0], secret: 'pps_secret123' }, { status: 201 });
      }),
      http.delete('*/api/provisioning-keys/:id', ({ params }) => {
        revoked = String(params.id);
        keys = keys.map((k) => (k.id === revoked ? { ...k, revokedAt: 1 } : k));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderApp('/profiles/p1', { user: admin });
    const row = await screen.findByRole('row', { name: /Line 1/ });
    expect(row).toHaveTextContent('12 / 500');
    expect(row).toHaveTextContent('Active');

    await user.click(screen.getByRole('button', { name: /New provisioning key/ }));
    const dialog = await screen.findByRole('dialog', { name: 'New provisioning key' });
    await user.type(within(dialog).getByLabelText('Name'), 'Line 2');
    await user.click(within(dialog).getByLabelText(/Only serials registered/));
    await user.type(within(dialog).getByLabelText('Tags'), 'batch-7, eu');
    await user.click(within(dialog).getByRole('button', { name: 'Create key' }));
    await waitFor(() => expect(sent).toMatchObject({ name: 'Line 2', mode: 'preregistered', tags: ['batch-7', 'eu'], customerId: null, maxDevices: null }));

    const shown = await screen.findByRole('dialog', { name: /Your provisioning key/ });
    expect(within(shown).getByLabelText('Provisioning key')).toHaveValue('pps_secret123');
    expect((within(shown).getByLabelText(/Firmware/) as HTMLTextAreaElement).value).toContain('cfg.provisionKey = "pps_secret123"');
    await user.click(within(shown).getByRole('button', { name: 'Done' }));

    await user.click(await screen.findByRole('button', { name: 'Revoke Line 1' }));
    await waitFor(() => expect(revoked).toBe('k1'));
    expect(await screen.findByRole('row', { name: /Line 1.*Revoked/ })).toBeInTheDocument();
  });
});
