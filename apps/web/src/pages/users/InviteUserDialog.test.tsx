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
