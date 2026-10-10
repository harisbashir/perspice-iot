import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { makeUser, renderApp } from '@/test/render';
import { server } from '@/test/server';

describe('signing out', () => {
  it('signing in again goes to the overview, not the page signed out from', async () => {
    const user = makeUser({ permissions: ['device.read'] });
    server.use(
      http.post('*/api/auth/logout', () => new HttpResponse(null, { status: 204 })),
      http.post('*/api/auth/login', () => HttpResponse.json({ accessToken: 'token-2', user })),
    );
    const u = userEvent.setup();
    const { router } = renderApp('/settings/profile', { user });
    await u.click(await screen.findByRole('button', { name: 'Account menu' }));
    await u.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
    await screen.findByLabelText('Email');
    await u.type(screen.getByLabelText('Email'), 'user@example.com');
    await u.type(screen.getByLabelText('Password'), 'secret-password');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('an expired session returns to the page after signing in', async () => {
    const user = makeUser({ permissions: ['device.read'] });
    server.use(http.post('*/api/auth/login', () => HttpResponse.json({ accessToken: 'token-2', user })));
    const u = userEvent.setup();
    const { router } = renderApp('/settings/profile'); // no session
    await u.type(await screen.findByLabelText('Email'), 'user@example.com');
    await u.type(screen.getByLabelText('Password'), 'secret-password');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/profile'));
  });
});
