import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { makeUser, renderApp } from '@/test/render';
import { server } from '@/test/server';

describe('map settings', () => {
  it('saves the tile server, and checks the URL has its placeholders', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.get('*/api/settings/map', () => HttpResponse.json({ urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OSM', maxZoom: 19 })),
      http.put('*/api/settings/map', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(body);
      }),
    );
    const user = userEvent.setup();
    renderApp('/settings/maps', { user: makeUser({ permissions: ['system.settings'] }) });
    const url = await screen.findByLabelText('Tile URL');
    await user.clear(url);
    await user.type(url, 'https://tiles.example.com/map.png');
    expect(screen.getByText('The URL needs {z}, {x} and {y} placeholders')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.clear(url);
    await user.type(url, 'https://{{s}.tile.openstreetmap.org/{{z}/{{x}/{{y}.png');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(body).toMatchObject({ urlTemplate: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19 }));
  });
});
