import { type Browser, type Page, expect, test } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { connectDevice, loadState, totp, waitForEmail } from './fixtures';

// Runs after the dashboards spec on the same stack: acme, its admin (ops@acme.test) and the
// Telecom RMS device "Tower 17" exist.
const BASE = process.env.E2E_BASE_URL ?? 'https://localhost:18443';
const ACME = BASE.replace('://localhost', '://acme.localhost');
const HOOKS = process.env.E2E_HOOKS_URL ?? 'http://localhost:18090';
const OWNER = 'owner@perspice.test';
const CUSTOMER_ADMIN = 'ops@acme.test';
const PASSWORD = 'e2e-password-123';

test.describe.configure({ mode: 'serial' });

let platform: Page;
let customer: Page;
let device: Awaited<ReturnType<typeof connectDevice>> | undefined;
let webhookSecret = '';
const state = { totpSecret: '', deviceId: '', deviceToken: '' };

async function signIn(browser: Browser, base: string, email: string, code?: () => string): Promise<Page> {
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
  await page.goto(`${base}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (code) {
    await page.getByLabel('Authentication code').fill(code());
    await page.getByRole('button', { name: 'Verify' }).click();
  }
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  return page;
}

async function owner<T>(path: string, init: RequestInit = {}): Promise<T> {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: OWNER, password: PASSWORD, totp: totp(state.totpSecret) }),
  });
  const { accessToken } = (await login.json()) as { accessToken: string };
  const res = await fetch(`${BASE}/api${path}`, { ...init, headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' } });
  expect(res.ok, `${init.method ?? 'GET'} ${path} → ${res.status}`).toBe(true);
  return (await res.json()) as T;
}

interface Hook {
  path: string;
  headers: Record<string, string>;
  body: string;
}
const hooks = async (): Promise<Hook[]> => (await (await fetch(`${HOOKS}/`)).json()) as Hook[];

test.beforeAll(async ({ browser }) => {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  Object.assign(state, loadState());
  platform = await signIn(browser, BASE, OWNER, () => totp(state.totpSecret));
  customer = await signIn(browser, ACME, CUSTOMER_ADMIN);
});

test.afterAll(async () => {
  await device?.client.endAsync(true);
});

test('platform admin adds a low-fuel rule to every Telecom RMS device', async () => {
  // Webhooks go to the recorder on the compose network, so allow plain HTTP to private addresses.
  await owner('/settings/webhooks', { method: 'PUT', body: JSON.stringify({ allowHttp: true, allowPrivate: true }) });
  const customers = await owner<{ id: string; name: string }[]>('/customers');
  const acme = customers.find((c) => c.name === 'Acme')!;
  const hook = await owner<{ secret: string }>('/webhooks', {
    method: 'POST',
    body: JSON.stringify({ name: 'Acme ops', url: 'http://hooks:8080/acme', events: ['alarm.raised', 'alarm.cleared'], customerId: acme.id }),
  });
  webhookSecret = hook.secret;

  await platform.getByRole('link', { name: 'Alarms' }).click();
  await platform.getByRole('link', { name: 'Alarm rules' }).click();
  await platform.getByRole('button', { name: 'New rule' }).click();
  const dialog = platform.getByRole('dialog');
  await dialog.getByLabel('Applies to').selectOption({ label: 'Telecom RMS' });
  await dialog.getByLabel('Name').fill('Low fuel');
  await dialog.getByLabel('Value').selectOption({ label: 'Fuel level' });
  await dialog.getByLabel('Is', { exact: true }).selectOption('<');
  await dialog.getByLabel('Threshold').fill('20');
  await dialog.getByLabel('Clear margin').fill('5');
  await expect(dialog.getByRole('status', { name: 'Rule preview' })).toHaveText('Raises when: Fuel level below 20 (clears at 25)');
  await dialog.getByRole('button', { name: 'Create rule' }).click();
  await expect(platform.getByRole('cell', { name: 'Low fuel', exact: true })).toBeVisible();
});

test('acme sees the alarm live within 2 s, by email and in the bell', async () => {
  device = await connectDevice(state.deviceId, state.deviceToken);
  await customer.goto(`${ACME}/alarms`);
  await expect(customer.getByText('No alarms here.')).toBeVisible();
  await device.publish({ fuel_level: 12 });
  await expect(customer.getByRole('link', { name: 'Low fuel' })).toBeVisible({ timeout: 2000 });
  const mail = await waitForEmail(CUSTOMER_ADMIN, 'major: Low fuel on Tower 17');
  expect(mail).toMatch(new RegExp(`${ACME.replace(/[.:/]/g, '\\$&')}/alarms/[0-9a-f-]{36}`));
  await expect(customer.getByRole('button', { name: /Notifications \([1-9]\d* unread\)/ })).toBeVisible();
  await expect(customer.getByLabel(/\d+ unacknowledged/)).toBeVisible();
});

test('acme acknowledges with a comment; recovery clears the alarm and emails again', async () => {
  await customer.getByRole('link', { name: 'Low fuel' }).click();
  await customer.getByLabel('Comment').fill('Tanker booked');
  await customer.getByRole('button', { name: 'Acknowledge' }).click();
  await expect(customer.getByText('acknowledged', { exact: true })).toBeVisible();
  await expect(customer.getByText('Tanker booked')).toBeVisible();

  await device!.publish({ fuel_level: 22 }); // within the margin: stays acknowledged
  await device!.publish({ fuel_level: 60 });
  await expect(customer.getByText('cleared', { exact: true })).toBeVisible({ timeout: 5000 });
  await waitForEmail(CUSTOMER_ADMIN, 'Cleared: Low fuel on Tower 17');
});

test('the webhook received signed alarm events', async () => {
  let received: Hook[] = [];
  for (let i = 0; i < 50 && received.length < 2; i++) {
    received = (await hooks()).filter((h) => h.path === '/acme');
    await new Promise((r) => setTimeout(r, 200));
  }
  expect(received.map((h) => JSON.parse(h.body).event)).toEqual(['alarm.raised', 'alarm.cleared']);
  for (const h of received) {
    const expected = `sha256=${createHmac('sha256', webhookSecret).update(`${h.headers['x-perspice-timestamp']}.${h.body}`).digest('hex')}`;
    expect(h.headers['x-perspice-signature']).toBe(expected);
  }
  expect(JSON.parse(received[0]!.body).data).toMatchObject({ alarm: { rule: 'Low fuel', severity: 'major' }, device: { name: 'Tower 17' } });
});

test('a scheduled dashboard report is emailed with a working link', async () => {
  await customer.goto(`${ACME}/reports`);
  await customer.getByRole('button', { name: 'New schedule' }).click();
  const dialog = customer.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Tower 17 daily');
  await dialog.getByLabel('Device').selectOption({ label: 'Tower 17' });
  await dialog.getByRole('button', { name: 'Create schedule' }).click();
  await customer.getByRole('button', { name: 'Run Tower 17 daily now' }).click();

  const mail = await waitForEmail(CUSTOMER_ADMIN, 'Report: Tower 17', 90_000);
  const link = /https?:\/\/\S+\/api\/files\/exports\/\S+/.exec(mail)![0];
  expect(link.startsWith(ACME)).toBe(true);
  const head = await customer.evaluate(async (url) => {
    const res = await fetch(url);
    return res.ok ? new TextDecoder().decode((await res.arrayBuffer()).slice(0, 5)) : `HTTP ${res.status}`;
  }, link.replace(/^https?:\/\/[^/]+/, ''));
  expect(head).toBe('%PDF-');
  await expect(async () => {
    await customer.reload();
    await expect(customer.getByText('Sent to 1 recipient')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
});
