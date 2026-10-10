import { type Page, expect, test } from '@playwright/test';
import { connectDevice, loadState, totp } from './fixtures';

// Runs after the other specs on the shared stack (project dependency): acme, its admin and the
// Beta customer exist.
const BASE = process.env.E2E_BASE_URL ?? 'https://localhost:18443';
const ACME = BASE.replace('://localhost', '://acme.localhost');
const OWNER = 'owner@perspice.test';
const CUSTOMER_ADMIN = 'ops@acme.test';
const PASSWORD = 'e2e-password-123';

test.describe.configure({ mode: 'serial' });

let page: Page;
const state = { totpSecret: '', deviceId: '', deviceToken: '' };
let owner = '';
let acmeAdmin = '';
let van = { id: '', token: '' };
let van8 = { id: '', token: '' };
let depot = { lat: 0, lng: 0 };

async function login(base: string, email: string, code?: string): Promise<string> {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, ...(code ? { totp: code } : {}) }),
  });
  return `Bearer ${((await res.json()) as { accessToken: string }).accessToken}`;
}

async function call<T>(auth: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, { ...init, headers: { authorization: auth, 'content-type': 'application/json' } });
  expect(res.ok, `${init.method ?? 'GET'} ${path} → ${res.status}`).toBe(true);
  return (await res.json()) as T;
}

/** As the acme admin, from the browser: Node can't resolve acme.localhost, browsers can. */
async function asAcme<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await page.evaluate(
    async ({ path, init, auth }) => {
      const r = await fetch(`/api${path}`, {
        method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
        headers: { authorization: auth, 'content-type': 'application/json' },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    { path, init, auth: acmeAdmin },
  );
  expect(res.status, `${init.method ?? 'GET'} ${path}`).toBeLessThan(300);
  return res.body as T;
}

/** `m` metres north of the depot's centre. */
const north = (m: number) => ({ lat: depot.lat + m / 111_195, lng: depot.lng });

const send = (values: Record<string, unknown>, ts?: number) =>
  fetch(`${BASE}/api/v1/device/telemetry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-device-token': van.token },
    body: JSON.stringify({ ...(ts ? { ts } : {}), values }),
  }).then((r) => expect(r.status).toBe(202));

test.beforeAll(async ({ browser }) => {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  Object.assign(state, loadState());
  owner = await login(BASE, OWNER, totp(state.totpSecret));
  const customers = await call<{ id: string; name: string }[]>(owner, '/customers');
  const acme = customers.find((c) => c.name === 'Acme')!;
  const beta = customers.find((c) => c.name === 'Beta')!;
  const profile = await call<{ id: string }>(owner, '/device-profiles', {
    method: 'POST',
    body: JSON.stringify({ name: 'Van tracker', locationMode: 'reported', trips: { enabled: true } }),
  });
  const created = await call<{ device: { id: string }; token: string }>(owner, '/devices', {
    method: 'POST',
    body: JSON.stringify({ name: 'Van 7', profileId: profile.id, customerId: acme.id }),
  });
  van = { id: created.device.id, token: created.token };
  const second = await call<{ device: { id: string }; token: string }>(owner, '/devices', {
    method: 'POST',
    body: JSON.stringify({ name: 'Van 8', profileId: profile.id, customerId: acme.id }),
  });
  van8 = { id: second.device.id, token: second.token };
  await call(owner, '/geofences', { method: 'POST', body: JSON.stringify({ name: 'Beta yard', customerId: beta.id, shape: { type: 'circle', center: { lat: 10, lng: 10 }, radiusM: 100 } }) });

  page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
  await page.goto(`${ACME}/login`);
  await page.getByLabel('Email').fill(CUSTOMER_ADMIN);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  acmeAdmin = await page.evaluate(async ({ email, password }) => {
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    return `Bearer ${((await r.json()) as { accessToken: string }).accessToken}`;
  }, { email: CUSTOMER_ADMIN, password: PASSWORD });
});

test("acme draws a depot geofence on the map and can't see another customer's", async () => {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Geofences' }).click();
  await page.getByRole('button', { name: 'New geofence' }).click();
  await page.getByLabel('Name').fill('Depot');
  await page.getByTestId('geofence-map').click({ position: { x: 300, y: 200 } });
  await page.getByLabel('Radius (m)').fill('500');
  await page.getByRole('button', { name: 'Create geofence' }).click();
  const list = page.getByRole('list', { name: 'Geofence list' });
  await expect(list.getByText('Depot')).toBeVisible();
  await expect(list.getByText('Beta yard')).toHaveCount(0);
  const mine = await asAcme<{ id: string; name: string; shape: { type: 'circle'; center: { lat: number; lng: number } } }[]>('/geofences');
  const g = mine.find((x) => x.name === 'Depot')!;
  depot = g.shape.center;
  const { customerId } = await asAcme<{ customerId: string }>(`/devices/${van.id}`);
  await asAcme('/alarm-rules', {
    body: { name: 'Van left depot', severity: 'major', scope: { kind: 'customer', customerId }, type: 'geofence', condition: { geofenceId: g.id } },
  });
});

test('the location tab follows the van live', async () => {
  await send(north(0));
  await page.goto(`${ACME}/devices/${van.id}`);
  await page.getByRole('tab', { name: 'Location' }).click();
  await expect(page.getByTestId('location-position')).toContainText(north(0).lat.toFixed(6));
  await send(north(100));
  await expect(page.getByTestId('location-position')).toContainText(north(100).lat.toFixed(6), { timeout: 2000 });
});

test('leaving the depot raises an alarm', async () => {
  await send(north(1500));
  await page.goto(`${ACME}/alarms`);
  await expect(page.getByRole('link', { name: 'Van left depot' })).toBeVisible({ timeout: 5000 });
});

test('a drive shows up as a trip with its distance', async () => {
  // Another van, replaying an hour-old drive over MQTT, as a tracker that was out of coverage
  // would (the HTTP device API allows 60 requests a minute).
  const tracker = await connectDevice(van8.id, van8.token);
  const pub = (m: number, ts: number) => tracker.client.publishAsync(`perspice/v1/${van8.id}/telemetry`, JSON.stringify({ ts, values: north(m) }), { qos: 1 });
  try {
    const start = Date.now() - 3_600_000;
    for (let i = 0; i < 3; i++) await pub(0, start + i * 10_000);
    for (let i = 0; i < 12; i++) await pub((i + 1) * 100, start + 30_000 + i * 10_000);
    for (let i = 0; i < 36; i++) await pub(1200, start + 150_000 + i * 10_000);
  } finally {
    await tracker.client.endAsync();
  }
  // The replayed messages take a moment to work through ingest and the rules process.
  await expect(async () => {
    await page.goto(`${ACME}/devices/${van8.id}`);
    await page.getByRole('tab', { name: 'Trips' }).click();
    await expect(page.getByRole('cell', { name: '1.2 km' })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
});

test('the overview map shows the van', async () => {
  await page.goto(`${ACME}/`);
  await expect(page.locator('.perspice-marker').first()).toBeVisible({ timeout: 10_000 });
});
