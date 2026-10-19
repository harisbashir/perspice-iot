import { BUILT_IN_ROLES } from '@perspice/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { RoleDto } from '@/api/types';
import { makeUser, renderApp } from '@/test/render';
import { server } from '@/test/server';

const role = (key: keyof typeof BUILT_IN_ROLES, name: string): RoleDto => ({
  id: key,
  key,
  name,
  scope: BUILT_IN_ROLES[key].scope,
  customerId: null,
  permissions: BUILT_IN_ROLES[key].permissions,
  builtIn: true,
});

describe('InviteUserDialog', () => {
  it('only lists roles the current user can grant', async () => {
    server.use(
      http.get('*/api/users', () => HttpResponse.json([])),
      http.get('*/api/roles', () =>
        HttpResponse.json([
          role('customer_admin', 'Customer Admin'),
          role('customer_operator', 'Customer Operator'),
          role('customer_viewer', 'Customer Viewer'),
          // A custom customer role with a permission the operator lacks.
          { ...role('customer_viewer', 'Branding editor'), id: 'custom', key: null, builtIn: false, permissions: ['branding.edit'] },
        ]),
      ),
    );
    const user = userEvent.setup();
    renderApp('/users', {
      user: makeUser({
        scopeType: 'customer',
        customerId: 'c1',
        roleKey: 'customer_operator',
        permissions: [...BUILT_IN_ROLES.customer_operator.permissions, 'user.read', 'user.manage'],
      }),
    });
    await user.click(await screen.findByRole('button', { name: /invite user/i }));
    const select = await screen.findByLabelText('Role');
    const options = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Choose a role', 'Customer Operator', 'Customer Viewer']);
  });
});

describe('invite links', () => {
  const invited = { id: 'u9', email: 'new@example.com', name: 'New', scopeType: 'platform', customerId: null, groupId: null, roleId: 'platform_admin', status: 'invited', lastLoginAt: null, createdAt: '2026-10-13T00:00:00Z' };

  it('shows the new user’s activation link to copy', async () => {
    const link = 'https://iot.example.com/activate?token=abc123';
    server.use(
      http.get('*/api/users', () => HttpResponse.json([])),
      http.get('*/api/roles', () => HttpResponse.json([role('platform_admin', 'Platform Admin')])),
      http.post('*/api/users/invite', () => HttpResponse.json({ ...invited, inviteLink: link }, { status: 201 })),
    );
    const user = userEvent.setup();
    renderApp('/users', { user: makeUser({ roleKey: 'super_admin', permissions: [...BUILT_IN_ROLES.super_admin.permissions] }) });
    await user.click(await screen.findByRole('button', { name: /invite user/i }));
    await user.type(await screen.findByLabelText('Email'), 'new@example.com');
    await user.type(screen.getByLabelText('Name'), 'New');
    await user.selectOptions(screen.getByLabelText('Role'), 'platform_admin');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));
    expect(await screen.findByLabelText('Invite link')).toHaveValue(link);
    await user.click(screen.getByRole('button', { name: /copy link/i }));
    expect(await navigator.clipboard.readText()).toBe(link);
  });

  it('copies a fresh link for an invited user from the list', async () => {
    const link = 'https://iot.example.com/activate?token=fresh';
    let minted = 0;
    server.use(
      http.get('*/api/users', () => HttpResponse.json([invited])),
      http.get('*/api/roles', () => HttpResponse.json([role('platform_admin', 'Platform Admin')])),
      http.post('*/api/users/u9/invite-link', () => {
        minted++;
        return HttpResponse.json({ link }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderApp('/users', { user: makeUser({ roleKey: 'super_admin', permissions: [...BUILT_IN_ROLES.super_admin.permissions] }) });
    await user.click(await screen.findByRole('button', { name: /actions for new@example.com/i }));
    await user.click(await screen.findByRole('menuitem', { name: 'Copy invite link' }));
    expect(await screen.findByLabelText('Invite link')).toHaveValue(link);
    expect(minted).toBe(1);
    await user.click(screen.getByRole('button', { name: /copy link/i }));
    expect(await navigator.clipboard.readText()).toBe(link);
  });
});
