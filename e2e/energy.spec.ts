import { type Browser, type Page, expect, test } from '@playwright/test';
import { loadState, totp } from './fixtures';

// Runs after the fleet spec on the shared stack (project dependency): Acme and its admin exist.
const BASE = process.env.E2E_BASE_URL ?? 'https://localhost:18443';
const ACME = BASE.replace('://localhost', '://acme.localhost');
const OWNER = 'owner@perspice.test';
const CUSTOMER_ADMIN = 'ops@acme.test';
const PASSWORD = 'e2e-password-123';

test.describe.configure({ mode: 'serial' });

let acme: Page;
const state = { totpSecret: '', deviceId: '', deviceToken: '' };
let gen = { id: '', token: '' };
let acmeAuth = '';

async function signIn(browser: Browser, base: string, email: string): Promise<Page> {
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
  await page.goto(`${base}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  return page;
}

async function ownerApi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: OWNER, password: PASSWORD, totp: totp(state.totpSecret) }),
  });
  const { accessToken } = (await login.json()) as { accessToken: string };
  const res = await fetch(`${BASE}/api${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  expect(res.ok, `${path} → ${res.status} ${await res.clone().text()}`).toBe(true);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** As the acme admin, from the browser (Node can't resolve acme.localhost). */
async function asAcme<T>(path: string): Promise<T> {
  return acme.evaluate(async ({ p, auth }) => (await fetch(`/api${p}`, { headers: { authorization: auth } })).json(), { p: path, auth: acmeAuth }) as Promise<T>;
}

const send = async (ts: number, values: Record<string, unknown>) => {
  const res = await fetch(`${BASE}/api/v1/device/telemetry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-device-token': gen.token },
    body: JSON.stringify({ ts, values }),
  });
  expect(res.status).toBe(202);
};

test.beforeAll(async ({ browser }) => {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  Object.assign(state, loadState());
  const customers = await ownerApi<{ id: string; name: string }[]>('/customers');
  const acmeId = customers.find((c) => c.name === 'Acme')!.id;
  const profile = await ownerApi<{ id: string }>('/device-profiles', {
    body: {
      name: 'Generator site',
      telemetrySchema: [
        { key: 'v', label: 'Voltage', unit: 'V', type: 'number' },
        { key: 'i', label: 'Current', unit: 'A', type: 'number' },
        { key: 'energy_kwh', label: 'Energy meter', unit: 'kWh', type: 'number' },
        { key: 'gen_running', label: 'Running', type: 'boolean' },
      ],
      calculated: [
        { key: 'power', label: 'Power', unit: 'W', decimals: 0, kind: 'formula', expr: 'v * i' },
        { key: 'energy_used', label: 'Energy used', unit: 'kWh', decimals: 2, kind: 'counter_delta', source: 'energy_kwh' },
        { key: 'run_s', label: 'Generator run time', unit: 's', kind: 'runtime', source: 'gen_running' },
      ],
    },
  });
  const created = await ownerApi<{ device: { id: string }; token: string }>('/devices', { body: { name: 'Site 9 generator', profileId: profile.id, customerId: acmeId } });
  gen = { id: created.device.id, token: created.token };
  const template = await ownerApi<{ id: string }>('/dashboard-templates', {
    body: {
      name: 'Generator energy',
      kind: 'device',
      profileId: profile.id,
      definition: {
        states: [
          {
            id: 'main',
            name: 'Energy',
            layout: [{ i: 'energy', x: 0, y: 0, w: 6, h: 6 }],
            widgets: [{ id: 'energy', type: 'energy-summary', title: 'Energy today', datasource: { kind: 'currentDevice', keys: ['energy_used'] }, settings: { range: 'today', showChart: false } }],
          },
        ],
        settings: { timewindow: { kind: 'relative', lastMs: 86_400_000 }, refreshS: 0 },
      },
    },
  });
  await ownerApi(`/device-profiles/${profile.id}/default-dashboard`, { method: 'PUT', body: { templateId: template.id } });
  // A very short interval so the reminder comes from a few seconds of run time.
  await ownerApi('/alarm-rules', {
    body: { name: 'Generator service', severity: 'major', scope: { kind: 'profile', profileId: profile.id }, type: 'maintenance_due', condition: { runtimeKey: 'run_s', everyHours: 0.005 } },
  });
  acme = await signIn(browser, ACME, CUSTOMER_ADMIN);
  acmeAuth = await acme.evaluate(async ({ email, password }) => {
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    return `Bearer ${((await r.json()) as { accessToken: string }).accessToken}`;
  }, { email: CUSTOMER_ADMIN, password: PASSWORD });
});

test('acme sets its energy tariff', async () => {
  await acme.goto(`${ACME}/settings/tariff`);
  const currency = acme.getByLabel('Currency');
  await currency.fill('GBP');
  await acme.getByLabel('Price per unit').fill('0.3');
  await acme.getByRole('button', { name: 'Save' }).click();
  await expect(acme.getByRole('button', { name: 'Use the platform default' })).toBeVisible();
});

test('calculated power, consumption and cost from the readings', async () => {
  const now = Date.now();
  await send(now - 30_000, { v: 230, i: 10, energy_kwh: 100, gen_running: true });
  await send(now - 20_000, { energy_kwh: 102.5, gen_running: true });
  await send(now - 10_000, { energy_kwh: 105, gen_running: true });

  await acme.goto(`${ACME}/devices/${gen.id}`);
  await expect(async () => {
    await acme.reload();
    await expect(acme.getByTestId('energy-total')).toHaveText('5 kWh', { timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  await expect(acme.getByTestId('energy-cost')).toHaveText('£1.50');
  await acme.getByRole('tab', { name: 'Overview' }).click();
  await expect(acme.getByTestId('value-power')).toHaveText(/2,?300/);
});

test('run hours raise a maintenance reminder; logging a service clears it', async () => {
  test.setTimeout(180_000);
  type Alarms = { items: { ruleName: string; status: string; device: { id: string }; message: string }[] };
  const reminder = async () => (await asAcme<Alarms>('/alarms?status=active,acknowledged,cleared')).items.find((a) => a.device.id === gen.id && a.ruleName === 'Generator service');
  // The engine checks a minute after the run time reports; the scheduler's timers run every 10 s.
  await expect.poll(async () => (await reminder())?.status, { timeout: 120_000, intervals: [5000] }).toBe('active');
  expect((await reminder())!.message).toMatch(/^Service due: /);

  await acme.goto(`${ACME}/devices/${gen.id}`);
  await acme.getByRole('tab', { name: 'Maintenance' }).click();
  await expect(acme.getByTestId('run-hours-run_s')).toContainText('since it was added');
  await acme.getByLabel('Note').fill('Oil and filters');
  await acme.getByRole('button', { name: 'Log service' }).click();
  await expect(acme.getByRole('cell', { name: 'Oil and filters' })).toBeVisible();
  await expect(acme.getByTestId('run-hours-run_s')).toContainText('0 h since the last service');
  await expect.poll(async () => (await reminder())?.status, { timeout: 10_000 }).toBe('cleared');
});
