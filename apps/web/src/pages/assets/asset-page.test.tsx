import type { AssetDto, AssetTypeDto, DeviceDto } from '@perspice/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { makeUser, renderApp } from '@/test/render';
import { server } from '@/test/server';

const admin = makeUser({ scopeType: 'customer', customerId: 'c1', roleKey: 'customer_admin', permissions: ['asset.read', 'asset.write', 'device.read', 'device.write', 'alarm.read'] });
const type: AssetTypeDto = { id: 't1', name: 'Site', icon: 'building', attributes: [{ key: 'kva', label: 'Supply (kVA)', type: 'number' }], defaultDashboardTemplateId: 'tpl', assetCount: 1, createdAt: 0, updatedAt: 0 };
const asset: AssetDto = {
  id: 'a2',
  name: 'Generator room',
  typeId: 't1',
  typeName: 'Site',
  customerId: 'c1',
  groupId: null,
  parentId: 'a1',
  location: null,
  attributes: { kva: 250 },
  path: [{ id: 'a1', name: 'Site 4' }],
  createdAt: 0,
  updatedAt: 0,
};
const dev = (id: string, name: string): DeviceDto => ({
  id,
  name,
  profileId: 'p1',
  customerId: 'c1',
  groupId: null,
  tags: [],
  status: 'online',
  lastSeen: Date.now(),
  firmwareVersion: null,
  location: null,
  offlineTimeoutS: null,
  deadTimeoutS: null,
  attributes: { client: {}, server: {}, shared: {} },
  latest: {},
  createdAt: '',
  updatedAt: '',
});
const definition = {
  states: [{ id: 'main', name: 'Site', layout: [{ i: 'k', x: 0, y: 0, w: 3, h: 3 }], widgets: [{ id: 'k', type: 'kpi', title: 'Devices', datasource: { kind: 'currentAsset', depth: 'subtree', profileId: null, keys: [] }, settings: { metric: 'total' } }] }],
  settings: { timewindow: { kind: 'relative', lastMs: 86_400_000 }, refreshS: 0 },
};

describe('asset page', () => {
  it('shows the breadcrumb and the dashboard, asking for data with the asset', async () => {
    let query: { assetId?: string } | undefined;
    server.use(
      http.get('*/api/assets/a2', () => HttpResponse.json(asset)),
      http.get('*/api/asset-types', () => HttpResponse.json([type])),
      http.get('*/api/assets/tree', () => HttpResponse.json([])),
      http.get('*/api/dashboards/asset/a2', () =>
        HttpResponse.json({ instanceId: 'i1', templateId: 'tpl', templateName: 'Site dashboard', templateVersion: 1, overridden: false, baseVersion: null, outdated: false, definition }),
      ),
      http.post('*/api/dashboards/data', async ({ request }) => {
        query = (await request.json()) as typeof query;
        return HttpResponse.json({ results: { k: { ok: true, data: { total: 4, online: 3, offline: 1, dead: 0, never: 0, messages24h: 0 } } } });
      }),
    );
    renderApp('/assets/a2', { user: admin });
    expect(await screen.findByRole('heading', { name: 'Generator room' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Assets › Site 4');
    expect(await screen.findByTestId('kpi')).toHaveTextContent('4');
    expect(query?.assetId).toBe('a2');
  });

  it('attaches and detaches devices, and shows the attributes', async () => {
    const puts: { device: string; assetId: string | null }[] = [];
    let attached = [dev('d1', 'Genset 1')];
    server.use(
      http.get('*/api/assets/a2', () => HttpResponse.json(asset)),
      http.get('*/api/asset-types', () => HttpResponse.json([type])),
      http.get('*/api/assets/tree', () => HttpResponse.json([])),
      http.get('*/api/dashboards/asset/a2', () => HttpResponse.json({ dashboard: null })),
      http.get('*/api/assets/a2/devices', () => HttpResponse.json(attached)),
      http.get('*/api/devices', () => HttpResponse.json({ items: [dev('d1', 'Genset 1'), dev('d2', 'Fuel sensor')], nextCursor: null })),
      http.put('*/api/devices/:id/asset', async ({ params, request }) => {
        const body = (await request.json()) as { assetId: string | null };
        puts.push({ device: String(params.id), assetId: body.assetId });
        attached = body.assetId ? [...attached, dev('d2', 'Fuel sensor')] : attached.filter((d) => d.id !== params.id);
        return HttpResponse.json({ asset: null });
      }),
    );
    const user = userEvent.setup();
    renderApp('/assets/a2', { user: admin });
    expect(await screen.findByTestId('asset-device-d1')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Device to attach'), 'd2');
    await user.click(screen.getByRole('button', { name: 'Attach' }));
    expect(await screen.findByTestId('asset-device-d2')).toBeInTheDocument();
    await user.click(within(screen.getByTestId('asset-device-d1')).getByRole('button', { name: 'Detach' }));
    await waitFor(() => expect(screen.queryByTestId('asset-device-d1')).not.toBeInTheDocument());
    expect(puts).toEqual([
      { device: 'd2', assetId: 'a2' },
      { device: 'd1', assetId: null },
    ]);
    await user.click(screen.getByRole('tab', { name: 'Details' }));
    expect(await screen.findByTestId('attr-kva')).toHaveTextContent('250');
  });
});

describe('devices and assets', () => {
  it("shows a device's asset as a breadcrumb", async () => {
    server.use(
      http.get('*/api/devices/d1', () => HttpResponse.json(dev('d1', 'Genset 1'))),
      http.get('*/api/devices/d1/asset', () => HttpResponse.json({ asset: { id: 'a2', name: 'Generator room', path: [{ id: 'a1', name: 'Site 4' }] } })),
    );
    renderApp('/devices/d1', { user: admin });
    const line = await screen.findByTestId('device-asset');
    await waitFor(() => expect(line).toHaveTextContent(/Asset:\s*Site 4 › Generator room/));
    expect(within(line).getByRole('link', { name: 'Generator room' })).toHaveAttribute('href', '/assets/a2');
  });

  it('attaches selected devices to an asset in bulk', async () => {
    let body: unknown;
    server.use(
      http.get('*/api/devices', () => HttpResponse.json({ items: [dev('d1', 'Genset 1'), dev('d2', 'Fuel sensor')], nextCursor: null })),
      http.get('*/api/assets/tree', () =>
        HttpResponse.json([{ id: 'a1', name: 'Site 4', typeId: 't1', parentId: null, customerId: 'c1', rollup: { devices: 0, online: 0, offline: 0, dead: 0, never: 0, alarms: 0, worstSeverity: null } }]),
      ),
      http.post('*/api/devices/bulk', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: 2, results: [] });
      }),
    );
    const user = userEvent.setup();
    renderApp('/devices', { user: admin });
    await user.click(await screen.findByLabelText('Select all devices'));
    await user.click(within(screen.getByRole('toolbar', { name: 'Selected devices' })).getByRole('button', { name: 'Asset' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Asset'), 'a1');
    await user.click(within(dialog).getByRole('button', { name: 'Apply to 2' }));
    await waitFor(() => expect(body).toEqual({ deviceIds: ['d1', 'd2'], action: { kind: 'asset', assetId: 'a1' } }));
  });
});
