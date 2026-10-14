import { BUILT_IN_ROLES } from '@perspice/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { makeUser, renderApp } from '@/test/render';
import { server } from '@/test/server';

const customerViewer = makeUser({ scopeType: 'customer', customerId: 'c1', roleKey: 'customer_viewer', permissions: [...BUILT_IN_ROLES.customer_viewer.permissions] });
const superAdmin = makeUser({ roleKey: 'super_admin', permissions: [...BUILT_IN_ROLES.super_admin.permissions] });

describe('help', () => {
  it('lists the articles a customer may read, without the platform ones', async () => {
    renderApp('/help', { user: customerViewer });
    const use = await screen.findByRole('region', { name: 'Using the platform' });
    expect(within(use).getByRole('link', { name: /^Devices\s*Finding/ })).toBeInTheDocument();
    expect(within(use).queryByRole('link', { name: /^Users, roles/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Running the platform' })).not.toBeInTheDocument();
    expect(screen.queryByText('Platform')).not.toBeInTheDocument();
  });

  it('shows platform articles to platform users, and filters by search', async () => {
    const user = userEvent.setup();
    renderApp('/help', { user: superAdmin });
    const admin = await screen.findByRole('region', { name: 'Running the platform' });
    expect(within(admin).getByRole('link', { name: /^Asset types ?Platform/ })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Search help'), 'asset');
    expect(within(screen.getByRole('region', { name: 'Running the platform' })).getByRole('link', { name: /^Asset types/ })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Using the platform' })).queryByRole('link', { name: /^Notifications/ })).not.toBeInTheDocument();
  });

  it('opens an article, with platform notes only for platform users', async () => {
    const { unmount } = renderApp('/help/devices', { user: customerViewer });
    expect(await screen.findByRole('heading', { level: 1, name: 'Devices' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Inside a device' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'For platform administrators' })).not.toBeInTheDocument();
    unmount();

    renderApp('/help/devices', { user: superAdmin });
    expect(await screen.findByRole('complementary', { name: 'For platform administrators' })).toBeInTheDocument();
  });

  it('refuses platform articles to customers', async () => {
    renderApp('/help/asset-types', { user: customerViewer });
    expect(await screen.findByText('Not found')).toBeInTheDocument();
  });

  it('the Help button opens the article for the current page', async () => {
    server.use(http.get('*/api/devices', () => HttpResponse.json({ items: [], nextCursor: null })), http.get('*/api/device-profiles', () => HttpResponse.json([])));
    const user = userEvent.setup();
    renderApp('/devices', { user: customerViewer });
    await user.click(await screen.findByRole('link', { name: 'Help: Devices' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Devices' })).toBeInTheDocument();
  });
});
