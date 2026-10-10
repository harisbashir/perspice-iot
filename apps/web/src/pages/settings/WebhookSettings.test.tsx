import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { makeUser, renderApp } from '@/test/render';
import { server } from '@/test/server';

const admin = makeUser({ scopeType: 'customer', customerId: 'c1', permissions: ['webhook.manage', 'audit.read'] });
const hook = { id: 'w1', customerId: 'c1', name: 'Ops', url: 'https://hooks.example.com/x', events: ['alarm.raised'], enabled: true, createdAt: 0 };

describe('webhook settings', () => {
  it('creates a webhook and shows its secret once', async () => {
    let body: unknown;
    let hooks: unknown[] = [];
    server.use(
      http.get('*/api/webhooks', () => HttpResponse.json(hooks)),
      http.post('*/api/webhooks', async ({ request }) => {
        body = await request.json();
        hooks = [hook];
        return HttpResponse.json({ ...hook, secret: 'whsec_abc' }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderApp('/settings/webhooks', { user: admin });
    await user.click(await screen.findByRole('button', { name: 'New webhook' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Ops');
    await user.clear(within(dialog).getByLabelText('URL'));
    await user.type(within(dialog).getByLabelText('URL'), 'https://hooks.example.com/x');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Device online/offline' }));
    await user.click(within(dialog).getByRole('button', { name: 'Create webhook' }));
    await waitFor(() => expect(body).toEqual({ name: 'Ops', url: 'https://hooks.example.com/x', events: ['alarm.raised', 'alarm.cleared', 'device.status_changed'] }));
    expect(await screen.findByTestId('webhook-secret')).toHaveTextContent('whsec_abc');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByTestId('webhook-secret')).toBeNull();
    expect(await screen.findByText('https://hooks.example.com/x')).toBeInTheDocument();
    expect(screen.queryByText('Destinations')).toBeNull(); // platform-only policy
  });

  it('reports a failed test call', async () => {
    server.use(
      http.get('*/api/webhooks', () => HttpResponse.json([hook])),
      http.post('*/api/webhooks/w1/test', () => HttpResponse.json({ ok: false, status: null, error: 'HTTP 500' })),
    );
    const user = userEvent.setup();
    renderApp('/settings/webhooks', { user: admin });
    await user.click(await screen.findByRole('button', { name: 'Send test' }));
    expect(await screen.findByText('Test failed')).toBeInTheDocument();
    expect(screen.getByText('HTTP 500')).toBeInTheDocument();
  });
});

describe('delivery log', () => {
  it('filters and retries failed deliveries', async () => {
    const queries: string[] = [];
    let retried = '';
    server.use(
      http.get('*/api/delivery-log', ({ request }) => {
        queries.push(new URL(request.url).search);
        return HttpResponse.json({
          items: [{ id: 'd1', channel: 'email', recipient: 'ops@x', subject: 'Low fuel', status: 'dead', attempts: 5, error: 'Email is not configured', createdAt: Date.now(), updatedAt: Date.now() }],
          nextCursor: null,
        });
      }),
      http.post('*/api/delivery-log/d1/retry', () => {
        retried = 'd1';
        return HttpResponse.json({}, { status: 202 });
      }),
    );
    const user = userEvent.setup();
    renderApp('/settings/deliveries', { user: admin });
    expect(await screen.findByText('Email is not configured')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Status'), 'Failed');
    await waitFor(() => expect(queries.at(-1)).toContain('status=failed%2Cdead'));
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(retried).toBe('d1'));
  });
});
