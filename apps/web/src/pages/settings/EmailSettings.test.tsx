import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { makeUser, renderApp } from '@/test/render';
import { server } from '@/test/server';

const admin = makeUser({ roleKey: 'super_admin', totpEnabled: true, permissions: ['system.settings'] });
const settings = http.get('*/api/settings/email', () =>
  HttpResponse.json({ driver: 'smtp', smtp: { host: 'mail', port: 25, secure: false, user: '', pass: '', from: 'x@y.z', hasPassword: false }, ses: null }),
);

describe('EmailSettings', () => {
  it('shows a success toast when the test email is sent', async () => {
    server.use(settings, http.post('*/api/settings/email/test', () => HttpResponse.json({ ok: true })));
    const user = userEvent.setup();
    renderApp('/settings/email', { user: admin });
    await user.click(await screen.findByRole('button', { name: 'Send test' }));
    expect(await screen.findByText('Test email sent')).toBeInTheDocument();
  });

  it('shows the error message when sending fails', async () => {
    server.use(
      settings,
      http.post('*/api/settings/email/test', () =>
        HttpResponse.json({ code: 'VALIDATION', message: 'Email is not configured', details: [] }, { status: 400 }),
      ),
    );
    const user = userEvent.setup();
    renderApp('/settings/email', { user: admin });
    await user.click(await screen.findByRole('button', { name: 'Send test' }));
    expect(await screen.findByText('Test email failed')).toBeInTheDocument();
    expect(screen.getByText('Email is not configured')).toBeInTheDocument();
  });
});
