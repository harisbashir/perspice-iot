import { alarmRule, command, dashboardInstance, dashboardTemplate, exportJob } from '../src/db/schema';
import { sampleDefinition } from './dashboard-fixtures';
import { createDevice, createProfile, ensureRole } from './factories';
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

TENANT_ENDPOINTS.push({
  name: 'put customer branding',
  method: 'put',
  path: (i) => `/api/customers/${i.customerId}/branding`,
  body: () => ({ productName: 'Hacked' }),
  create: async ({ b }) => ({ customerId: b.customer.id }),
});

/** Customer B's device (created by B's admin through the API, like a real tenant would). */
const bDevice = async ({ t, b }: TenantContext): Promise<Ids> => {
  const profile = await createProfile(t.db);
  const { device } = await createDevice(t.db, { profileId: profile.id, customerId: b.customer.id });
  return { deviceId: device.id, profileId: profile.id };
};

TENANT_ENDPOINTS.push(
  { name: 'get device', method: 'get', path: (i) => `/api/devices/${i.deviceId}`, create: bDevice },
  { name: 'patch device', method: 'patch', path: (i) => `/api/devices/${i.deviceId}`, body: () => ({ name: 'Hacked' }), create: bDevice },
  { name: 'delete device', method: 'delete', path: (i) => `/api/devices/${i.deviceId}`, create: bDevice },
  { name: 'list devices', method: 'list', path: () => '/api/devices', create: bDevice },
  {
    name: 'put server attributes',
    method: 'put',
    path: (i) => `/api/devices/${i.deviceId}/attributes/server`,
    body: () => ({ x: 1 }),
    create: bDevice,
  },
  {
    name: 'put shared attributes',
    method: 'put',
    path: (i) => `/api/devices/${i.deviceId}/attributes/shared`,
    body: () => ({ x: 1 }),
    create: bDevice,
  },
  { name: 'get device debug log', method: 'get', path: (i) => `/api/devices/${i.deviceId}/debug`, create: bDevice },
  { name: "get profile used only by B's devices", method: 'get', path: (i) => `/api/device-profiles/${i.profileId}`, create: bDevice },
  { name: 'list profiles', method: 'list', path: () => '/api/device-profiles', create: bDevice },
);

const bCommand = async (ctx: TenantContext): Promise<Ids> => {
  const deviceId = (await bDevice(ctx)).deviceId!;
  const [row] = await ctx.t.db
    .insert(command)
    .values({ deviceId, customerId: ctx.b.customer.id, name: 'x' })
    .returning({ id: command.id });
  return { deviceId, commandId: row!.id };
};

TENANT_ENDPOINTS.push(
  { name: 'send command', method: 'post', path: (i) => `/api/devices/${i.deviceId}/commands`, body: () => ({ name: 'x' }), create: bDevice },
  { name: 'command history', method: 'get', path: (i) => `/api/devices/${i.deviceId}/commands`, create: bDevice },
  { name: 'get command', method: 'get', path: (i) => `/api/commands/${i.commandId}`, create: bCommand },
);

TENANT_ENDPOINTS.push(
  { name: 'telemetry history', method: 'get', path: (i) => `/api/devices/${i.deviceId}/telemetry?keys=a`, create: bDevice },
  { name: 'telemetry latest', method: 'get', path: (i) => `/api/devices/${i.deviceId}/telemetry/latest`, create: bDevice },
  { name: 'telemetry keys', method: 'get', path: (i) => `/api/devices/${i.deviceId}/telemetry/keys`, create: bDevice },
);

/** Customer B's dashboard instance (for the device dashboard of B's device). */
const bInstance = async (ctx: TenantContext): Promise<Ids> => {
  const ids = await bDevice(ctx);
  const [tpl] = await ctx.t.db
    .insert(dashboardTemplate)
    .values({ name: 'B', kind: 'device', profileId: ids.profileId!, definition: sampleDefinition() })
    .returning({ id: dashboardTemplate.id });
  const [inst] = await ctx.t.db
    .insert(dashboardInstance)
    .values({ templateId: tpl!.id, customerId: ctx.b.customer.id })
    .returning({ id: dashboardInstance.id });
  return { ...ids, templateId: tpl!.id, instanceId: inst!.id };
};

TENANT_ENDPOINTS.push(
  { name: 'device dashboard', method: 'get', path: (i) => `/api/dashboards/device/${i.deviceId}`, create: bDevice },
  {
    name: 'customise instance',
    method: 'put',
    path: (i) => `/api/dashboard-instances/${i.instanceId}/override`,
    body: () => ({ definition: sampleDefinition() }),
    create: bInstance,
  },
  { name: 're-sync instance', method: 'delete', path: (i) => `/api/dashboard-instances/${i.instanceId}/override`, create: bInstance },
  { name: "get B's template", method: 'get', path: (i) => `/api/dashboard-templates/${i.templateId}`, create: bInstance },
  { name: 'list templates', method: 'list', path: () => '/api/dashboard-templates', create: bInstance },
);

const bExport = async ({ t, b }: TenantContext): Promise<Ids> => {
  const [row] = await t.db
    .insert(exportJob)
    .values({ userId: b.admin.id, customerId: b.customer.id, kind: 'devices', format: 'csv', params: { title: 'Devices' } })
    .returning({ id: exportJob.id });
  return { exportId: row!.id };
};

TENANT_ENDPOINTS.push(
  {
    name: 'export telemetry',
    method: 'post',
    path: () => '/api/exports',
    body: (i) => ({ kind: 'telemetry', format: 'csv', params: { deviceId: i.deviceId, keys: ['a'], from: 0, to: Date.now() } }),
    create: bDevice,
  },
  {
    name: 'export widget data',
    method: 'post',
    path: () => '/api/exports',
    body: (i) => ({ kind: 'widget', format: 'csv', params: { datasource: { kind: 'device', deviceId: i.deviceId, keys: ['a'] }, mode: 'latest' } }),
    create: bDevice,
  },
  {
    name: 'dashboard PDF report',
    method: 'post',
    path: () => '/api/reports/dashboard',
    body: (i) => ({ deviceId: i.deviceId, timewindow: { kind: 'relative', lastMs: 3_600_000 } }),
    create: bDevice,
  },
  { name: "get B's export", method: 'get', path: (i) => `/api/exports/${i.exportId}`, create: bExport },
  { name: 'list exports', method: 'list', path: () => '/api/exports', create: bExport },
);

/** A customer-level and a device-level alarm rule of customer B. */
const bRules = async (ctx: TenantContext): Promise<Ids> => {
  const ids = await bDevice(ctx);
  const common = {
    name: 'B rule',
    type: 'threshold' as const,
    condition: { key: 'a', op: '<', value: 1 },
    severity: 'major' as const,
    recipients: { roles: [], userIds: [], groupIds: [] },
    channels: ['inapp' as const],
  };
  const [c] = await ctx.t.db.insert(alarmRule).values({ ...common, scopeKind: 'customer', customerId: ctx.b.customer.id }).returning({ id: alarmRule.id });
  const [d] = await ctx.t.db.insert(alarmRule).values({ ...common, scopeKind: 'device', deviceId: ids.deviceId }).returning({ id: alarmRule.id });
  return { ...ids, customerRuleId: c!.id, deviceRuleId: d!.id };
};
const ruleBody = (i: Ids) => ({
  name: 'X',
  severity: 'major',
  scope: { kind: 'device', deviceId: i.deviceId },
  type: 'threshold',
  condition: { key: 'a', op: '<', value: 1 },
});

TENANT_ENDPOINTS.push(
  { name: "get B's customer rule", method: 'get', path: (i) => `/api/alarm-rules/${i.customerRuleId}`, create: bRules },
  { name: "get B's device rule", method: 'get', path: (i) => `/api/alarm-rules/${i.deviceRuleId}`, create: bRules },
  { name: "update B's rule", method: 'put', path: (i) => `/api/alarm-rules/${i.customerRuleId}`, body: ruleBody, create: bRules },
  { name: "delete B's rule", method: 'delete', path: (i) => `/api/alarm-rules/${i.deviceRuleId}`, create: bRules },
  { name: 'rule on B device', method: 'post', path: () => '/api/alarm-rules', body: ruleBody, create: bDevice },
  { name: 'effective rules of B device', method: 'get', path: (i) => `/api/devices/${i.deviceId}/alarm-rules/effective`, create: bDevice },
  { name: 'list alarm rules', method: 'list', path: () => '/api/alarm-rules', create: bRules },
);
