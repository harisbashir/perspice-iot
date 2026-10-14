import { BUILT_IN_ROLES } from '@perspice/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { makeUser, renderApp } from '@/test/render';
import { server } from '@/test/server';

const key = (o: Record<string, unknown>) => ({ id: 'k1', name: 'ERP', permissions: ['device.read'], expiresAt: null, lastUsed: null, createdAt: 0, ...o });

describe('API keys', () => {
  it('creates a key with chosen permissions and an expiry, showing it once', async () => {
    let sent: { name: string; permissions: string[]; expiresAt?: number } | undefined;
    server.use(
      http.get('*/api/api-keys', () => HttpResponse.json([])),
      http.post('*/api/api-keys', async ({ request }) => {
        sent = (await request.json()) as typeof sent;
        return HttpResponse.json({ ...key({ id: 'k9', name: sent!.name }), key: 'pk_secret' }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderApp('/settings/api-keys', { user: makeUser({ scopeType: 'customer', customerId: 'c1', permissions: [...BUILT_IN_ROLES.customer_viewer.permissions] }) });
    expect(await screen.findByText('You have no API keys.')).toBeInTheDocument();
    expect(screen.queryByText('Everyone else’s keys')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /New API key/ }));
    const dialog = await screen.findByRole('dialog', { name: 'New API key' });
    // Only permissions the user holds are offered.
    expect(within(dialog).queryByLabelText('user.manage')).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Name'), 'Grafana');
    await user.click(within(dialog).getByLabelText('telemetry.read'));
    await user.click(within(dialog).getByRole('button', { name: 'Create key' }));
    await waitFor(() => expect(sent).toMatchObject({ name: 'Grafana', permissions: ['telemetry.read'] }));
    expect(sent!.expiresAt! - Date.now()).toBeGreaterThan(89 * 86_400_000);
    expect(await screen.findByLabelText('API key')).toHaveValue('pk_secret');
  });

  it('admins see their colleagues’ keys and revoke them after confirming', async () => {
    let deleted = '';
    server.use(
      http.get('*/api/api-keys', ({ request }) =>
        HttpResponse.json(new URL(request.url).searchParams.get('scope') ? [key({ id: 'k2', name: 'Old sync', createdBy: { id: 'u2', name: 'Sam', email: 'sam@acme.test' } })] : []),
      ),
      http.delete('*/api/api-keys/:id', ({ params }) => {
        deleted = String(params.id);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderApp('/settings/api-keys', { user: makeUser({ scopeType: 'customer', customerId: 'c1', permissions: [...BUILT_IN_ROLES.customer_admin.permissions] }) });
    const row = await screen.findByRole('row', { name: /Old sync/ });
    expect(row).toHaveTextContent('Sam (sam@acme.test)');
    await user.click(within(row).getByRole('button', { name: 'Revoke Old sync' }));
    await user.click(await screen.findByRole('button', { name: 'Revoke key' }));
    await waitFor(() => expect(deleted).toBe('k2'));
  });
});
