import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { makeUser, renderApp } from '@/test/render';
import { server } from '@/test/server';

const defaults = {
  timezone: null,
  effectiveTimezone: 'Europe/London',
  preferences: { email: true, push: true, minSeverity: 'info', quietHours: null, criticalBypassesQuietHours: true, digest: { threshold: 10, windowMin: 15 } },
};

describe('NotificationSettings', () => {
  it('saves channels, minimum level, quiet hours and timezone', async () => {
    let saved: unknown;
    server.use(
      http.get('*/api/me/notification-preferences', () => HttpResponse.json(defaults)),
      http.get('*/api/push/public-key', () => HttpResponse.json({ publicKey: null, subscriptions: 0 })),
      http.put('*/api/me/notification-preferences', async ({ request }) => {
        saved = await request.json();
        return HttpResponse.json({ ...defaults, ...(saved as object) });
      }),
    );
    const user = userEvent.setup();
    renderApp('/settings/notifications', { user: makeUser() });
    await user.click(await screen.findByRole('checkbox', { name: 'Email' }));
    await user.selectOptions(screen.getByLabelText('Send email and push for'), 'Major alarms and above');
    await user.click(screen.getByRole('checkbox', { name: /Hold email and push during quiet hours/ }));
    expect(screen.getByLabelText('From')).toHaveValue('22:00');
    expect(screen.getByText('Using Europe/London.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Timezone'), 'Asia/Karachi');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(saved).toEqual({
        timezone: 'Asia/Karachi',
        preferences: { ...defaults.preferences, email: false, minSeverity: 'major', quietHours: { from: '22:00', to: '07:00' } },
      }),
    );
    expect(await screen.findByText('Notification settings saved')).toBeInTheDocument();
    expect(screen.getByText('Push notifications are not set up on this server.')).toBeInTheDocument();
  });

  it('sends a test notification', async () => {
    server.use(
      http.get('*/api/me/notification-preferences', () => HttpResponse.json(defaults)),
      http.get('*/api/push/public-key', () => HttpResponse.json({ publicKey: null, subscriptions: 0 })),
      http.post('*/api/me/notification-preferences/test', () => HttpResponse.json({ queued: 2 }, { status: 202 })),
    );
    const user = userEvent.setup();
    renderApp('/settings/notifications', { user: makeUser() });
    await user.click(await screen.findByRole('button', { name: 'Send a test notification' }));
    expect(await screen.findByText('Test notification sent')).toBeInTheDocument();
    expect(screen.getByText(/2 channels/)).toBeInTheDocument();
  });
});
