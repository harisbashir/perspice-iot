import { type Browser, type Page, expect, test } from '@playwright/test';
import { loadState, totp } from './fixtures';

// Runs after the energy spec on the shared stack (project dependency): Acme, its admin and the
// "Site 9 generator" device (with today's energy readings) exist.
const BASE = process.env.E2E_BASE_URL ?? 'https://localhost:18443';
const ACME = BASE.replace('://localhost', '://acme.localhost');
const OWNER = 'owner@perspice.test';
const CUSTOMER_ADMIN = 'ops@acme.test';
const PASSWORD = 'e2e-password-123';

test.describe.configure({ mode: 'serial' });

let acme: Page;
const state = { totpSecret: '', deviceId: '', deviceToken: '' };

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
  return (await res.json()) as T;
}

test.beforeAll(async ({ browser }) => {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  Object.assign(state, loadState());
  const site = await ownerApi<{ id: string }>('/asset-types', { body: { name: 'Site', icon: 'building', attributes: [{ key: 'address', label: 'Address', type: 'text' }] } });
  await ownerApi('/asset-types', { body: { name: 'Plant room', icon: 'zap' } });
  const tpl = await ownerApi<{ id: string }>('/dashboard-templates', {
    body: {
      name: 'Site overview',
      kind: 'asset',
      assetTypeId: site.id,
      definition: {
        states: [
          {
            id: 'main',
            name: 'Site',
            layout: [
              { i: 'devices', x: 0, y: 0, w: 3, h: 3 },
              { i: 'energy', x: 3, y: 0, w: 6, h: 6 },
            ],
            widgets: [
              { id: 'devices', type: 'kpi', title: 'Devices on site', datasource: { kind: 'currentAsset', keys: [] }, settings: { metric: 'total' } },
              { id: 'energy', type: 'energy-summary', title: 'Site energy today', datasource: { kind: 'currentAsset', keys: ['energy_used'] }, settings: { range: 'today', showChart: false } },
            ],
          },
        ],
        settings: { timewindow: { kind: 'relative', lastMs: 86_400_000 }, refreshS: 0 },
      },
    },
  });
  await ownerApi(`/asset-types/${site.id}`, { method: 'PATCH', body: { defaultDashboardTemplateId: tpl.id } });
  acme = await signIn(browser, ACME, CUSTOMER_ADMIN);
});

test('acme builds a site with a plant room inside', async () => {
  await acme.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Assets' }).click();
  await acme.getByRole('button', { name: 'New asset' }).click();
  let dialog = acme.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Depot site');
  await dialog.getByLabel('Type').selectOption({ label: 'Site' });
  await dialog.getByLabel('Address').fill('1 Depot Road');
  await dialog.getByRole('button', { name: 'Create asset' }).click();
  const site = acme.getByTestId('asset-Depot site');
  await expect(site).toBeVisible();

  await site.getByRole('button', { name: 'Add inside' }).first().click();
  dialog = acme.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Plant room');
  await dialog.getByLabel('Type').selectOption({ label: 'Plant room' });
  await dialog.getByRole('button', { name: 'Create asset' }).click();
  await expect(site.getByTestId('asset-Plant room')).toBeVisible();
});

test('the generator is attached to the plant room and rolls up to the site', async () => {
  await acme.getByTestId('asset-Plant room').getByRole('link', { name: 'Plant room' }).click();
  await expect(acme.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Depot site');
  await acme.getByRole('tab', { name: 'Devices' }).click();
  await acme.getByLabel('Device to attach').selectOption({ label: 'Site 9 generator' });
  await acme.getByRole('button', { name: 'Attach' }).click();
  await expect(acme.getByRole('link', { name: 'Site 9 generator' })).toBeVisible();

  await acme.goto(`${ACME}/assets`);
  await expect(acme.getByTestId('asset-Depot site').getByTestId('rollup').first()).toContainText('1 device');

  // The device shows where it is.
  await acme.getByRole('link', { name: 'Depot site' }).click();
  await acme.getByRole('tab', { name: 'Devices' }).click();
  await acme.getByRole('link', { name: 'Site 9 generator' }).click();
  await expect(acme.getByTestId('device-asset')).toContainText('Depot site › Plant room');
});

test("the site's dashboard counts its devices and sums their energy", async () => {
  await acme.getByTestId('device-asset').getByRole('link', { name: 'Depot site' }).click();
  await expect(acme.getByRole('heading', { name: 'Depot site' })).toBeVisible();
  await expect(acme.getByTestId('kpi')).toHaveText('1');
  // The energy spec's readings today: 5 kWh at the flat GBP tariff.
  await expect(acme.getByTestId('energy-total')).toHaveText('5 kWh');
  await expect(acme.getByTestId('energy-cost')).toHaveText('£1.50');
  await acme.getByRole('tab', { name: 'Details' }).click();
  await expect(acme.getByTestId('attr-address')).toHaveText('1 Depot Road');
});
