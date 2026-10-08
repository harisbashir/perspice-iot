import { describe, expect, it } from 'vitest';
import type { AuthUser } from '../../src/auth/auth.types';
import { descendantGroupIds, scopeOf } from '../../src/rbac/scope';

const base: AuthUser = {
  kind: 'user',
  id: 'u1',
  apiKeyId: null,
  sessionId: 's1',
  email: 'a@b.c',
  name: 'A',
  scopeType: 'customer',
  customerId: 'c1',
  groupId: null,
  roleId: 'r1',
  roleKey: 'customer_admin',
  permissions: [],
  totpEnabled: false,
};

const groups = [
  { id: 'g1', parentId: null },
  { id: 'g2', parentId: 'g1' },
  { id: 'g3', parentId: 'g2' },
  { id: 'g4', parentId: null },
];

describe('scope', () => {
  it('platform users get platform scope', () => {
    expect(scopeOf({ ...base, scopeType: 'platform', customerId: null }, groups)).toEqual({ kind: 'platform' });
  });

  it('customer users without a group see the whole customer', () => {
    expect(scopeOf(base, groups)).toEqual({ kind: 'customer', customerId: 'c1', groupIds: null });
  });

  it('group users see their group and its descendants', () => {
    const scope = scopeOf({ ...base, groupId: 'g1' }, groups);
    expect(scope.kind === 'customer' && [...(scope.groupIds ?? [])].sort()).toEqual(['g1', 'g2', 'g3']);
  });

  it('handles cycles without looping', () => {
    const cyclic = [
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ];
    expect(descendantGroupIds('a', cyclic).sort()).toEqual(['a', 'b']);
  });
});
