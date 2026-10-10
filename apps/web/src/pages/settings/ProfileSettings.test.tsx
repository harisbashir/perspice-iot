import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { makeUser, renderApp } from '@/test/render';
import { server } from '@/test/server';

describe('TOTP enrolment', () => {
  it('shows a QR code, then confirms the code', async () => {
    const me = makeUser({ totpEnabled: false });
    let enabledWith: string | undefined;
    server.use(
      http.post('*/api/auth/totp/setup', () =>
        HttpResponse.json({ otpauthUrl: 'otpauth://totp/Perspice:user@example.com?secret=ABC&issuer=Perspice', secret: 'ABC' }),
      ),
      http.post('*/api/auth/totp/enable', async ({ request }) => {
        enabledWith = ((await request.json()) as { code: string }).code;
        return HttpResponse.json({ ...me, totpEnabled: true });
      }),
    );
    const user = userEvent.setup();
    renderApp('/settings/profile', { user: me });
    await user.click(await screen.findByRole('button', { name: /set up two-factor/i }));
    const qr = await screen.findByAltText('QR code for your authenticator app');
    expect(qr.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    await user.type(screen.getByLabelText('Code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(await screen.findByText('Two-factor authentication is on.')).toBeInTheDocument();
    expect(enabledWith).toBe('123456');
  });
});
