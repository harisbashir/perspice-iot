import { readFileSync } from 'node:fs';
import { type Browser, type Page, expect, test } from '@playwright/test';
import { connectOtaDevice, loadState, totp } from './fixtures';

// Runs after the location spec on the shared stack (project dependency): Acme and its admin exist.
const BASE = process.env.E2E_BASE_URL ?? 'https://localhost:18443';
const ACME = BASE.replace('://localhost', '://acme.localhost');
const OWNER = 'owner@perspice.test';
const CUSTOMER_ADMIN = 'ops@acme.test';
const PASSWORD = 'e2e-password-123';

test.describe.configure({ mode: 'serial' });

let platform: Page;
let acme: Page;
const state = { totpSecret: '', deviceId: '', deviceToken: '' };
let credentials: { id: string; name: string; token: string; claimCode: string }[] = [];
const devices: Awaited<ReturnType<typeof connectOtaDevice>>[] = [];

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
  expect(res.ok, `${path} → ${res.status}`).toBe(true);
  return (await res.json()) as T;
}

test.beforeAll(async ({ browser }) => {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  Object.assign(state, loadState());
  await ownerApi('/device-profiles', { body: { name: 'Fleet meter' } });
  platform = await signIn(browser, BASE, OWNER, () => totp(state.totpSecret));
  acme = await signIn(browser, ACME, CUSTOMER_ADMIN);
});

test.afterAll(async () => {
  for (const d of devices) await d.close().catch(() => undefined);
});

test('the platform imports devices from a CSV and saves their credentials', async () => {
  await platform.goto(`${BASE}/devices`);
  await platform.getByRole('button', { name: 'Import' }).click();
  const dialog = platform.getByRole('dialog');
  const csv = ['name,profile,customer,tags,claim', 'Fleet meter 1,Fleet meter,Acme,north,', 'Fleet meter 2,Fleet meter,,,yes', 'Fleet meter 3,No such profile,,,'].join('\n');
  await dialog.getByLabel('CSV file').setInputFiles({ name: 'devices.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await dialog.getByRole('button', { name: 'Check' }).click();
  await expect(dialog.getByTestId('import-report')).toContainText('Row 3, profile: No such profile');
  await expect(dialog.getByRole('button', { name: 'Import' })).toBeDisabled();

  await dialog.getByLabel('CSV file').setInputFiles({ name: 'devices.csv', mimeType: 'text/csv', buffer: Buffer.from(csv.split('\n').slice(0, 3).join('\n')) });
  await dialog.getByRole('button', { name: 'Check' }).click();
  await expect(dialog.getByText('2 devices are ready to import.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Import' }).click();
  await expect(dialog.getByTestId('import-created')).toHaveText('2 devices created.');
  const [download] = await Promise.all([platform.waitForEvent('download'), dialog.getByRole('button', { name: 'Download credentials (CSV)' }).click()]);
  expect(download.suggestedFilename()).toBe('device-credentials.csv');
  const lines = readFileSync(await download.path()).toString('utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  expect(lines[0]).toBe('id,name,token,claim_code');
  credentials = lines.slice(1).map((l) => {
    const [id, name, token, claimCode] = l.split(',');
    return { id: id!, name: name!, token: token!, claimCode: claimCode ?? '' };
  });
  expect(credentials.map((c) => c.name)).toEqual(['Fleet meter 1', 'Fleet meter 2']);
  expect(credentials[1]!.claimCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
});

test('acme adds the spare device with its claim code', async () => {
  await acme.goto(`${ACME}/devices`);
  await acme.getByRole('button', { name: 'Add with claim code' }).click();
  const dialog = acme.getByRole('dialog');
  await dialog.getByLabel('Claim code').fill(credentials[1]!.claimCode.toLowerCase());
  await dialog.getByLabel('Name').fill('Fleet meter 2 (boiler room)');
  await dialog.getByRole('button', { name: 'Add device' }).click();
  await expect(acme).toHaveURL(new RegExp(`/devices/${credentials[1]!.id}$`));
  await expect(acme.getByRole('heading', { name: 'Fleet meter 2 (boiler room)' })).toBeVisible();
});

test('acme tags both meters at once', async () => {
  await acme.goto(`${ACME}/devices`);
  await acme.getByLabel('Search devices').fill('Fleet meter');
  await acme.getByLabel('Select Fleet meter 1').check();
  await acme.getByLabel('Select Fleet meter 2 (boiler room)').check();
  const bar = acme.getByRole('toolbar', { name: 'Selected devices' });
  await expect(bar).toContainText('2 devices selected');
  await bar.getByRole('button', { name: 'Tags' }).click();
  await acme.getByRole('dialog').getByLabel('Add tags').fill('pilot');
  await acme.getByRole('dialog').getByRole('button', { name: 'Apply to 2' }).click();
  await expect(bar).toBeHidden();
  await expect(acme.getByTestId(`device-row-${credentials[0]!.id}`)).toContainText('north, pilot');
  await expect(acme.getByTestId(`device-row-${credentials[1]!.id}`)).toContainText('pilot');
});

test('the platform rolls out new firmware; the devices download, verify and apply it', async () => {
  for (const c of credentials) devices.push(await connectOtaDevice(c.id, c.token, '1.0.0'));

  await platform.goto(`${BASE}/firmware`);
  await platform.getByRole('button', { name: 'Upload firmware' }).click();
  const upload = platform.getByRole('dialog');
  await upload.getByLabel('Profile').selectOption({ label: 'Fleet meter' });
  await upload.getByLabel('Version').fill('1.1.0');
  await upload.getByLabel('Image (.bin)').setInputFiles({ name: 'meter-1.1.0.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(64 * 1024, 7) });
  await upload.getByRole('button', { name: 'Upload' }).click();
  const row = platform.getByTestId('firmware-1.1.0');
  await expect(row).toContainText('64 KB');

  await row.getByRole('button', { name: 'Deploy' }).click();
  const deploy = platform.getByRole('dialog');
  await deploy.getByLabel('Customer').selectOption({ label: 'Acme' });
  await deploy.getByRole('button', { name: 'Start update' }).click();
  await expect(platform.getByRole('heading', { name: 'Update to Fleet meter 1.1.0' })).toBeVisible();
  // The scheduler sends on its 15 s tick; the devices update and report the new version.
  await expect(platform.getByText('Completed')).toBeVisible({ timeout: 60_000 });
  for (const c of credentials) await expect(platform.getByTestId(`ota-device-${c.id}`)).toContainText('Updated');
  expect(devices.map((d) => d.version())).toEqual(['1.1.0', '1.1.0']);
});

test("acme sees the update on the device's Firmware tab", async () => {
  await acme.goto(`${ACME}/devices/${credentials[0]!.id}`);
  await acme.getByRole('tab', { name: 'Firmware' }).click();
  await expect(acme.getByText('Running firmware: 1.1.0')).toBeVisible();
  await expect(acme.getByRole('cell', { name: '1.1.0' })).toBeVisible();
  await expect(acme.locator('tbody').getByText('Updated')).toBeVisible();
});
