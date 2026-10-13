import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { makeUser, renderApp } from '@/test/render';
import { server } from '@/test/server';

describe('settings tabs', () => {
  it('open their page from another tab, not a path nested under it', async () => {
    server.use(
      http.get('*/api/settings/map', () => HttpResponse.json({ urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OSM', maxZoom: 19 })),
    );
    const user = userEvent.setup();
    renderApp('/settings/profile', { user: makeUser({ permissions: ['system.settings'] }) });
    const nav = await screen.findByRole('navigation', { name: 'Settings' });
    const maps = await screen.findByRole('link', { name: 'Maps' });
    expect(nav).toContainElement(maps);
    expect(maps).toHaveAttribute('href', '/settings/maps');
    await user.click(maps);
    expect(await screen.findByLabelText('Tile URL')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Maps' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Email' })).toHaveAttribute('href', '/settings/email');
  });
});
