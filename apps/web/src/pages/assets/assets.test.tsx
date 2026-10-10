import type { AssetTreeRow, AssetTypeDto } from '@perspice/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { makeUser, renderApp } from '@/test/render';
import { server } from '@/test/server';

const customerAdmin = makeUser({ scopeType: 'customer', customerId: 'c1', roleKey: 'customer_admin', permissions: ['asset.read', 'asset.write', 'device.read'] });
const viewer = makeUser({ scopeType: 'customer', customerId: 'c1', roleKey: 'customer_viewer', permissions: ['asset.read', 'device.read'] });

const types: AssetTypeDto[] = [
  { id: 't1', name: 'Site', icon: 'building', attributes: [{ key: 'kva', label: 'Supply (kVA)', type: 'number' }], defaultDashboardTemplateId: null, assetCount: 1, createdAt: 0, updatedAt: 0 },
  { id: 't2', name: 'Generator room', icon: 'zap', attributes: [], defaultDashboardTemplateId: null, assetCount: 1, createdAt: 0, updatedAt: 0 },
];
const rollup = (o: Partial<AssetTreeRow['rollup']> = {}): AssetTreeRow['rollup'] => ({ devices: 0, online: 0, offline: 0, dead: 0, never: 0, alarms: 0, worstSeverity: null, ...o });
const tree: AssetTreeRow[] = [
  { id: 'a1', name: 'Site 4', typeId: 't1', parentId: null, customerId: 'c1', rollup: rollup({ devices: 3, online: 2, offline: 1, alarms: 2, worstSeverity: 'major' }) },
  { id: 'a2', name: 'Generator room', typeId: 't2', parentId: 'a1', customerId: 'c1', rollup: rollup({ devices: 1, online: 1 }) },
];

describe('asset tree', () => {
  it('nests assets and shows device and alarm roll-ups', async () => {
    server.use(http.get('*/api/asset-types', () => HttpResponse.json(types)), http.get('*/api/assets/tree', () => HttpResponse.json(tree)));
    renderApp('/assets', { user: viewer });
    const site = await screen.findByTestId('asset-Site 4');
    expect(within(site).getAllByTestId('rollup')[0]).toHaveTextContent('3 devices · 2 online · 1 offline');
    expect(within(site).getByTestId('rollup-alarms')).toHaveTextContent('major 2 alarms');
    expect(within(site).getByTestId('asset-Generator room')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New asset/ })).not.toBeInTheDocument();
  });

  it('creates a sub-asset with attributes from its type', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.get('*/api/asset-types', () => HttpResponse.json(types)),
      http.get('*/api/assets/tree', () => HttpResponse.json(tree)),
      http.post('*/api/assets', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: 'a3', ...body }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderApp('/assets', { user: customerAdmin });
    const site = await screen.findByTestId('asset-Site 4');
    await user.click(within(site).getAllByRole('button', { name: 'Add inside' })[0]!);
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Site 4 annex');
    expect(within(dialog).getByLabelText('Inside')).toHaveValue('a1');
    await user.type(within(dialog).getByLabelText('Supply (kVA)'), '250');
    await user.click(within(dialog).getByRole('button', { name: 'Create asset' }));
    await waitFor(() => expect(body).toMatchObject({ name: 'Site 4 annex', typeId: 't1', parentId: 'a1', attributes: { kva: 250 }, location: null }));
  });
});

describe('asset types', () => {
  it('the platform defines a type with attributes', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.get('*/api/asset-types', () => HttpResponse.json([])),
      http.post('*/api/asset-types', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: 't9', ...body, assetCount: 0 }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderApp('/asset-types', { user: makeUser({ permissions: ['asset.read', 'asset.type.manage'] }) });
    await user.click(await screen.findByRole('button', { name: /New asset type/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Site');
    await user.click(within(dialog).getByRole('button', { name: 'Add attribute' }));
    await user.type(within(dialog).getByLabelText('Attribute key'), 'kva');
    await user.type(within(dialog).getByLabelText('Attribute label'), 'Supply');
    await user.selectOptions(within(dialog).getByLabelText('Attribute type'), 'number');
    await user.click(within(dialog).getByRole('button', { name: 'Create asset type' }));
    await waitFor(() => expect(body).toEqual({ name: 'Site', icon: 'building', attributes: [{ key: 'kva', label: 'Supply', type: 'number' }], defaultDashboardTemplateId: null }));
  });
});
