import { describe, expect, it } from 'vitest';
import { AssetInputSchema, AssetTypeInputSchema, BUILT_IN_ROLES, BulkActionSchema, DataSourceSchema, buildAssetTree, checkAssetAttributes } from '../src/index.js';

const U = '11111111-1111-4111-8111-111111111111';

describe('asset types', () => {
  it('needs unique attribute keys', () => {
    const ok = AssetTypeInputSchema.parse({ name: 'Site', attributes: [{ key: 'address', label: 'Address', type: 'text' }] });
    expect(ok).toMatchObject({ name: 'Site', icon: 'building', defaultDashboardTemplateId: null });
    const dup = AssetTypeInputSchema.safeParse({ name: 'Site', attributes: [{ key: 'a', label: 'A', type: 'text' }, { key: 'a', label: 'B', type: 'number' }] });
    expect(dup.success).toBe(false);
  });
});

describe('assets', () => {
  it('parses input with defaults', () => {
    expect(AssetInputSchema.parse({ name: ' Site 4 ', typeId: U })).toEqual({ name: 'Site 4', typeId: U, attributes: {} });
    expect(AssetInputSchema.safeParse({ name: 'X', typeId: U, location: { lat: 91, lng: 0 } }).success).toBe(false);
  });

  it('checks attribute values against the type', () => {
    const defs = [
      { key: 'address', label: 'Address', type: 'text' as const },
      { key: 'kva', label: 'Rating', type: 'number' as const },
      { key: 'commissioned', label: 'Commissioned', type: 'date' as const },
    ];
    expect(checkAssetAttributes(defs, { address: 'Main St 1', kva: 250, commissioned: '2024-05-01' })).toEqual([]);
    expect(checkAssetAttributes(defs, { address: 5, kva: 'big', commissioned: '01/05/2024', colour: 'red' })).toEqual([
      { key: 'address', message: 'Address must be text' },
      { key: 'kva', message: 'Rating must be a number' },
      { key: 'commissioned', message: 'Commissioned must be a date (YYYY-MM-DD)' },
      { key: 'colour', message: 'Unknown attribute "colour"' },
    ]);
    expect(checkAssetAttributes(defs, { kva: null })).toEqual([]);
  });

  it('builds a tree from a flat list, children sorted by name, orphans at the top', () => {
    const rows = [
      { id: 'b', parentId: 'a', name: 'Generator room' },
      { id: 'a', parentId: null, name: 'Site 4' },
      { id: 'c', parentId: 'a', name: 'Battery room' },
      { id: 'd', parentId: 'gone', name: 'Orphan' }, // parent outside the user's view
    ];
    const tree = buildAssetTree(rows);
    expect(tree.map((n) => n.id)).toEqual(['d', 'a']);
    expect(tree[1]!.children.map((n) => n.name)).toEqual(['Battery room', 'Generator room']);
  });
});

describe('asset integration points', () => {
  it('adds the currentAsset source, the asset bulk action and permissions', () => {
    expect(DataSourceSchema.parse({ kind: 'currentAsset', keys: ['power'] })).toEqual({ kind: 'currentAsset', depth: 'subtree', profileId: null, keys: ['power'] });
    expect(BulkActionSchema.parse({ kind: 'asset', assetId: null })).toEqual({ kind: 'asset', assetId: null });
    expect(BUILT_IN_ROLES.customer_admin.permissions).toEqual(expect.arrayContaining(['asset.read', 'asset.write']));
    expect(BUILT_IN_ROLES.customer_viewer.permissions).toContain('asset.read');
    expect(BUILT_IN_ROLES.customer_admin.permissions).not.toContain('asset.type.manage');
    expect(BUILT_IN_ROLES.platform_admin.permissions).toContain('asset.type.manage');
  });
});
