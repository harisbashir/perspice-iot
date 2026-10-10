import { type Browser, type Page, expect, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import { connectDevice, loadState, totp } from './fixtures';

// Runs after the core flow on the same stack (project dependency): acme, its admin and the
// Telecom RMS device "Tower 17" exist, and the Beta customer has a device of its own.
const BASE = process.env.E2E_BASE_URL ?? 'https://localhost:18443';
const ACME = BASE.replace('://localhost', '://acme.localhost');
const OWNER = 'owner@perspice.test';
const CUSTOMER_ADMIN = 'ops@acme.test';
const PASSWORD = 'e2e-password-123';

test.describe.configure({ mode: 'serial' });

let platform: Page;
let customer: Page;
let device: Awaited<ReturnType<typeof connectDevice>> | undefined;
const state = { totpSecret: '', deviceId: '', deviceToken: '' };

async function signIn(browser: Browser, base: string, email: string, code?: () => string): Promise<Page> {
  const page = await (await browser.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true })).newPage();
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

async function ownerToken(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: OWNER, password: PASSWORD, totp: totp(state.totpSecret) }),
  });
  return ((await res.json()) as { accessToken: string }).accessToken;
}

test.beforeAll(async ({ browser }) => {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  Object.assign(state, loadState());
  platform = await signIn(browser, BASE, OWNER, () => totp(state.totpSecret));
  customer = await signIn(browser, ACME, CUSTOMER_ADMIN);
});

test.afterAll(async () => {
  await device?.client.endAsync(true);
});

test('platform admin generates a Telecom RMS dashboard and adds a gauge in the builder', async () => {
  await platform.getByRole('link', { name: 'Dashboards' }).click();
  await platform.getByRole('button', { name: 'Generate from profile' }).click();
  const dialog = platform.getByRole('dialog');
  await dialog.getByLabel('Profile').selectOption({ label: 'Telecom RMS' });
  await dialog.getByRole('button', { name: 'Generate' }).click();
  await expect(platform).toHaveURL(/\/dashboards\/[0-9a-f-]{36}\/edit$/);

  await platform.getByRole('button', { name: 'Add widget' }).click();
  await platform.getByRole('button', { name: /^Radial gauge/ }).click();
  await platform.getByRole('complementary', { name: 'Widget settings' }).getByLabel('Title').fill('Fuel gauge');
  await platform.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(platform.getByText('Saved as version 2', { exact: true })).toBeVisible();
});

test('acme admin sees the new dashboard on Tower 17 with live values within 2 s', async () => {
  device = await connectDevice(state.deviceId, state.deviceToken);
  await customer.goto(`${ACME}/devices/${state.deviceId}`);
  await expect(customer.getByRole('region', { name: 'Fuel gauge' })).toBeVisible();
  await device.publish({ fuel_level: 42.5, mains_v: 229 });
  await expect(customer.getByRole('region', { name: 'Fuel level' }).getByTestId('value')).toContainText('42.5', { timeout: 2000 });
});

test('acme customises its copy, then re-syncs after the template changes', async () => {
  await customer.getByRole('link', { name: 'Customise' }).click();
  await customer.getByRole('button', { name: 'Select Fuel gauge' }).click();
  await customer.getByRole('complementary', { name: 'Widget settings' }).getByRole('button', { name: 'Remove' }).click();
  await customer.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(customer).toHaveURL(new RegExp(`/devices/${state.deviceId}$`));
  await expect(customer.getByRole('region', { name: 'Fuel level' })).toBeVisible();
  await expect(customer.getByRole('region', { name: 'Fuel gauge' })).toHaveCount(0);

  // The platform admin renames the gauge in the template.
  await platform.getByRole('button', { name: 'Select Fuel gauge' }).click();
  await platform.getByRole('complementary', { name: 'Widget settings' }).getByLabel('Title').fill('Fuel tank gauge');
  await platform.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(platform.getByText('Saved as version 3', { exact: true })).toBeVisible();

  await customer.reload();
  await expect(customer.getByRole('status').filter({ hasText: 'has changed since this dashboard was customised' })).toBeVisible();
  await customer.getByRole('button', { name: 'Re-sync with template' }).click();
  await expect(customer.getByRole('region', { name: 'Fuel tank gauge' })).toBeVisible();
});

test('acme exports the History tab to XLSX', async () => {
  await customer.getByRole('tab', { name: 'History' }).click();
  const download = customer.waitForEvent('download');
  await customer.getByRole('button', { name: 'Export', exact: true }).click();
  await customer.getByRole('menuitem', { name: 'Excel (XLSX)' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^tower-17-telemetry-.*\.xlsx$/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile((await file.path())!);
  const sheet = wb.worksheets[0]!;
  expect(sheet.getRow(1).getCell(1).value).toBe('Time (UTC)');
  expect(sheet.rowCount).toBeGreaterThan(1);
});

test('acme requests a PDF report and the notification links to a working download', async () => {
  await customer.getByRole('tab', { name: 'Dashboard' }).click();
  await customer.getByRole('button', { name: 'PDF report' }).click();
  await expect(customer).toHaveURL(/\/exports\/[0-9a-f-]{36}$/);
  const jobUrl = customer.url();
  await expect(customer.getByRole('link', { name: 'Download' })).toBeVisible({ timeout: 90_000 });

  await customer.goto(`${ACME}/`);
  await customer.getByRole('button', { name: /Notifications \([1-9]\d* unread\)/ }).click();
  await customer.getByRole('menuitem', { name: /Your export is ready/ }).first().click();
  await expect(customer).toHaveURL(jobUrl);
  const href = (await customer.getByRole('link', { name: 'Download' }).getAttribute('href'))!;
  // Fetched from the page: *.localhost names resolve in the browser, not necessarily in Node.
  const head = await customer.evaluate(async (url) => {
    const res = await fetch(url);
    return res.ok ? new TextDecoder().decode((await res.arrayBuffer()).slice(0, 5)) : `HTTP ${res.status}`;
  }, href);
  expect(head).toBe('%PDF-');
});

test("acme admin cannot open Beta's device dashboard", async () => {
  const owner = await ownerToken();
  const list = (await (await fetch(`${BASE}/api/devices?search=Beta%20site`, { headers: { authorization: `Bearer ${owner}` } })).json()) as {
    items: { id: string }[];
  };
  const betaDevice = list.items[0]!.id;
  const status = await customer.evaluate(
    async ({ id, email, password }) => {
      const login = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const { accessToken } = (await login.json()) as { accessToken: string };
      return (await fetch(`/api/dashboards/device/${id}`, { headers: { authorization: `Bearer ${accessToken}` } })).status;
    },
    { id: betaDevice, email: CUSTOMER_ADMIN, password: PASSWORD },
  );
  expect(status).toBe(404);
  await customer.goto(`${ACME}/devices/${betaDevice}`);
  await expect(customer.getByRole('heading', { name: 'Not found' })).toBeVisible();
});
