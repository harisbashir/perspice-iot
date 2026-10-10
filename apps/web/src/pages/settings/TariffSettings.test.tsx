import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { makeUser, renderApp } from '@/test/render';
import { server } from '@/test/server';

const customerAdmin = makeUser({ scopeType: 'customer', customerId: 'c1', roleKey: 'customer_admin', permissions: ['tariff.manage', 'telemetry.read'] });

describe('energy tariff settings', () => {
  it('a customer on the platform default saves a time-of-use tariff of its own', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.get('*/api/tariff', () => HttpResponse.json({ tariff: { currency: 'EUR', defaultRate: 0.25, periods: [], customerId: null, inherited: true } })),
      http.put('*/api/tariff', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...body, customerId: 'c1', inherited: false });
      }),
    );
    const user = userEvent.setup();
    renderApp('/settings/tariff', { user: customerAdmin });
    expect(await screen.findByTestId('tariff-status')).toHaveTextContent('Using the platform default');
    const currency = screen.getByLabelText('Currency');
    await user.clear(currency);
    await user.type(currency, 'gbp');
    await user.click(screen.getByRole('button', { name: 'Add period' }));
    const period = screen.getByTestId('tariff-period-0');
    const price = within(period).getByLabelText('Period price');
    await user.clear(price);
    await user.type(price, '0.4');
    // An end before the start can't be saved.
    const to = within(period).getByLabelText('To hour');
    await user.clear(to);
    await user.type(to, '9');
    expect(screen.getByText('A period ends after it starts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.clear(to);
    await user.type(to, '21');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(body).toEqual({ currency: 'GBP', defaultRate: 0.25, periods: [{ name: 'Peak', rate: 0.4, days: [1, 2, 3, 4, 5], from: 17, to: 21 }] }),
    );
    expect(await screen.findByRole('button', { name: 'Use the platform default' })).toBeInTheDocument();
  });

  it('platform users pick the default or a customer', async () => {
    const asked: (string | null)[] = [];
    server.use(
      http.get('*/api/customers', () => HttpResponse.json([{ id: 'c1', name: 'Acme', slug: 'acme' }])),
      http.get('*/api/tariff', ({ request }) => {
        asked.push(new URL(request.url).searchParams.get('customerId'));
        return HttpResponse.json({ tariff: null });
      }),
    );
    const user = userEvent.setup();
    renderApp('/settings/tariff', { user: makeUser({ permissions: ['tariff.manage', 'customer.read'] }) });
    expect(await screen.findByTestId('tariff-status')).toHaveTextContent('Applies to customers without a tariff of their own');
    await user.selectOptions(screen.getByLabelText('Tariff for'), 'c1');
    expect(await screen.findByText('No tariff yet: energy is shown without cost.')).toBeInTheDocument();
    expect(asked).toEqual([null, 'c1']);
  });
});
