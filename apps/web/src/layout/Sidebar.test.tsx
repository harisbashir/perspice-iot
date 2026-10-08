import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeUser, renderApp } from '@/test/render';

describe('Sidebar', () => {
  it('hides items the user lacks permission for', async () => {
    renderApp('/', {
      user: makeUser({
        scopeType: 'customer',
        customerId: 'c1',
        roleKey: 'customer_viewer',
        permissions: ['device.read', 'profile.read', 'telemetry.read', 'notification.read'],
      }),
    });
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(nav).toHaveTextContent('Devices');
    expect(nav).not.toHaveTextContent('Users');
    expect(nav).not.toHaveTextContent('Customers');
    expect(nav).not.toHaveTextContent('Audit log');
  });

  it('shows administration items to platform admins', async () => {
    renderApp('/', { user: makeUser({ permissions: ['device.read', 'user.read', 'customer.read', 'audit.read', 'profile.write'] }) });
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    for (const label of ['Devices', 'Users', 'Customers', 'Audit log', 'Device profiles']) expect(nav).toHaveTextContent(label);
  });

  it('sends a super admin without 2FA to enrol first', async () => {
    const { router } = renderApp('/devices', { user: makeUser({ roleKey: 'super_admin', totpEnabled: false, permissions: ['device.read'] }) });
    await screen.findByRole('navigation', { name: 'Main' });
    expect(router.state.location.pathname).toBe('/settings/profile');
  });
});
