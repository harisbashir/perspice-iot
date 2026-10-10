import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { makeUser, renderApp } from '@/test/render';
import { server } from '@/test/server';
import { slugError } from './CustomersPage';

describe('customer slug validation', () => {
  it('accepts valid slugs and rejects invalid or reserved ones', () => {
    expect(slugError('acme-north')).toBeNull();
    expect(slugError('ab')).toMatch(/3–40/);
    expect(slugError('Acme')).toMatch(/lowercase/);
    expect(slugError('acme_north')).not.toBeNull();
    expect(slugError('admin')).toMatch(/reserved/);
  });

  it('shows the error and disables create for an invalid subdomain', async () => {
    server.use(http.get('*/api/customers', () => HttpResponse.json([])));
    const user = userEvent.setup();
    renderApp('/customers', { user: makeUser({ permissions: ['customer.read', 'customer.manage'] }) });
    await user.click(await screen.findByRole('button', { name: /new customer/i }));
    await user.type(screen.getByLabelText('Name'), 'Acme');
    expect(screen.getByLabelText('Subdomain')).toHaveValue('acme');
    await user.clear(screen.getByLabelText('Subdomain'));
    await user.type(screen.getByLabelText('Subdomain'), 'Bad Slug');
    expect(screen.getByRole('alert')).toHaveTextContent(/lowercase/);
    expect(screen.getByRole('button', { name: 'Create customer' })).toBeDisabled();
  });
});
