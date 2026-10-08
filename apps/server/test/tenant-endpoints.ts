import { ensureRole } from './factories';
import type { TestApp } from './harness';

export interface TenantSide {
  customer: { id: string; slug: string };
  admin: { id: string; email: string };
  auth: string;
}

export interface TenantContext {
  t: TestApp;
  /** The attacker: a customer admin of customer A. */
  a: TenantSide;
  /** The victim: customer B, whose objects A must never see. */
  b: TenantSide;
}

export type Ids = Record<string, string>;

export interface TenantEndpoint {
  name: string;
  /** `list` = GET a collection; assert none of `ids` appear in it. */
  method: 'get' | 'post' | 'put' | 'patch' | 'delete' | 'list';
  path: (ids: Ids) => string;
  body?: (ids: Ids) => unknown;
  /** Creates customer B's objects and returns their ids. */
  create: (ctx: TenantContext) => Promise<Ids>;
}

/**
 * Every customer-owned endpoint appends an entry here (plan Task 8). The suite asserts that
 * customer A's admin gets 404 on B's objects and that lists never include them.
 */
export const TENANT_ENDPOINTS: TenantEndpoint[] = [];

const bUser = async ({ t, b }: TenantContext): Promise<Ids> => {
  const res = await t.http
    .post('/api/users/invite')
    .set('Authorization', b.auth)
    .send({
      email: `victim-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: 'Victim',
      roleId: (await ensureRole(t.db, 'customer_viewer')).id,
    });
  return { userId: res.body.id, customerId: b.customer.id };
};

const bGroup = async ({ t, b }: TenantContext): Promise<Ids> => {
  const res = await t.http.post(`/api/customers/${b.customer.id}/groups`).set('Authorization', b.auth).send({ name: 'G' });
  return { groupId: res.body.id, customerId: b.customer.id };
};

TENANT_ENDPOINTS.push(
  { name: 'get user', method: 'get', path: (i) => `/api/users/${i.userId}`, create: bUser },
  { name: 'patch user', method: 'patch', path: (i) => `/api/users/${i.userId}`, body: () => ({ name: 'Hacked' }), create: bUser },
  { name: 'delete user', method: 'delete', path: (i) => `/api/users/${i.userId}`, create: bUser },
  { name: 'resend invite', method: 'post', path: (i) => `/api/users/${i.userId}/resend-invite`, create: bUser },
  { name: 'list users', method: 'list', path: () => '/api/users', create: bUser },
  { name: 'list groups', method: 'get', path: (i) => `/api/customers/${i.customerId}/groups`, create: bGroup },
  { name: 'create group', method: 'post', path: (i) => `/api/customers/${i.customerId}/groups`, body: () => ({ name: 'X' }), create: bGroup },
  {
    name: 'patch group',
    method: 'patch',
    path: (i) => `/api/customers/${i.customerId}/groups/${i.groupId}`,
    body: () => ({ name: 'X' }),
    create: bGroup,
  },
  { name: 'delete group', method: 'delete', path: (i) => `/api/customers/${i.customerId}/groups/${i.groupId}`, create: bGroup },
);
