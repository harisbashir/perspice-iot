import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { makeUser, renderApp } from '@/test/render';
import { server } from '@/test/server';

async function fillAndSubmit() {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Email'), 'a@example.com');
  await user.type(screen.getByLabelText('Password'), 'correct-horse-battery');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  return user;
}

describe('LoginPage', () => {
  it('navigates to / after a successful login', async () => {
    server.use(
      http.post('*/api/auth/login', () => HttpResponse.json({ accessToken: 't', user: makeUser({ name: 'Alice' }) })),
    );
    const { router } = renderApp('/login');
    await fillAndSubmit();
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
  });

  it('shows the code input when the server asks for TOTP', async () => {
    let calls = 0;
    server.use(
      http.post('*/api/auth/login', async ({ request }) => {
        calls++;
        const body = (await request.json()) as { totp?: string };
        if (!body.totp) return HttpResponse.json({ code: 'TOTP_REQUIRED', message: 'Two-factor code required' }, { status: 401 });
        return HttpResponse.json({ accessToken: 't', user: makeUser() });
      }),
    );
    const { router } = renderApp('/login');
    const user = await fillAndSubmit();
    const code = await screen.findByLabelText('Authentication code');
    await user.type(code, '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(calls).toBe(2);
  });

  it('shows when a locked account can try again', async () => {
    server.use(
      http.post('*/api/auth/login', () =>
        HttpResponse.json(
          { code: 'ACCOUNT_LOCKED', message: 'Account temporarily locked', details: { retryAfterSeconds: 900 } },
          { status: 423 },
        ),
      ),
    );
    renderApp('/login');
    await fillAndSubmit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again in 15 minutes');
  });

  it('shows a generic message for wrong credentials', async () => {
    server.use(
      http.post('*/api/auth/login', () =>
        HttpResponse.json({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' }, { status: 401 }),
      ),
    );
    renderApp('/login');
    await fillAndSubmit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
  });

  it('redirects signed-out users to /login', async () => {
    const { router } = renderApp('/devices');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });
});
