import { describe, expect, it } from 'vitest';
import { BUILT_IN_ROLES, PERMISSIONS, canGrant } from '../src/index.js';

describe('roles', () => {
  it('customer admin can grant customer viewer', () => {
    expect(canGrant(BUILT_IN_ROLES.customer_admin.permissions, BUILT_IN_ROLES.customer_viewer.permissions)).toBe(
      true,
    );
  });

  it('customer viewer cannot grant customer admin', () => {
    expect(canGrant(BUILT_IN_ROLES.customer_viewer.permissions, BUILT_IN_ROLES.customer_admin.permissions)).toBe(
      false,
    );
  });

  it('super admin has every permission', () => {
    expect([...BUILT_IN_ROLES.super_admin.permissions].sort()).toEqual([...PERMISSIONS].sort());
  });

  it('platform admin lacks system.settings and backup.manage', () => {
    const perms = BUILT_IN_ROLES.platform_admin.permissions;
    expect(perms).not.toContain('system.settings');
    expect(perms).not.toContain('backup.manage');
    expect(perms).toContain('customer.manage');
  });

  it('support has only read permissions plus audit.read', () => {
    for (const p of BUILT_IN_ROLES.support.permissions) {
      expect(p.endsWith('.read')).toBe(true);
    }
    expect(BUILT_IN_ROLES.support.permissions).toContain('audit.read');
  });
});
