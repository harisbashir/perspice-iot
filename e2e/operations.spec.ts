import { type Page, expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadState, totp } from './fixtures';

// Runs last on the shared stack (project dependency): the core flow's device "Tower 17" exists.
const BASE = process.env.E2E_BASE_URL ?? 'https://localhost:18443';
const OWNER = 'owner@perspice.test';
const PASSWORD = 'e2e-password-123';

test.describe.configure({ mode: 'serial' });

let page: Page;
const state = { totpSecret: '', deviceId: '', deviceToken: '' };
let backupFile = '';

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
  page = await (await browser.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true })).newPage();
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill(OWNER);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('Authentication code').fill(totp(state.totpSecret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
});

test('the System page shows every process healthy', async () => {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'System' }).click();
  const processes = page.locator('table').first();
  for (const role of ['api', 'ingest', 'rules', 'scheduler', 'renderer']) {
    await expect(processes.getByRole('row').filter({ hasText: role }).first()).toContainText('healthy');
  }
  await expect(page.getByText(/^Not running:/)).toHaveCount(0);
});

test('backs up now and downloads the backup', async () => {
  await page.getByRole('button', { name: 'Back up now' }).click();
  await expect(page.getByText(/^Latest: perspice-backup-/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Back up now' })).toBeEnabled({ timeout: 60_000 });
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download latest' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^perspice-backup-.*\.pbk$/);
  backupFile = join(mkdtempSync(join(tmpdir(), 'e2e-backup-')), download.suggestedFilename());
  await download.saveAs(backupFile);
});

test('restoring the backup brings back a deleted device, with the platform in maintenance meanwhile', async () => {
  const auth = { authorization: `Bearer ${await ownerToken()}` };
  const del = await fetch(`${BASE}/api/devices/${state.deviceId}`, { method: 'DELETE', headers: auth });
  expect(del.ok).toBe(true);
  expect((await fetch(`${BASE}/api/devices/${state.deviceId}`, { headers: auth })).status).toBe(404);

  await page.getByLabel('Backup file').setInputFiles(backupFile);
  await page.getByRole('alertdialog', { name: 'Confirm restore' }).getByRole('button', { name: 'Restore' }).click();

  // Once maintenance is on, any API call answers 503 and the banner appears.
  await expect
    .poll(async () => ((await (await fetch(`${BASE}/api/public/maintenance`)).json()) as { maintenance: boolean }).maintenance, { timeout: 60_000, intervals: [100] })
    .toBe(true);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Devices' }).click();
  await expect(page.getByText('The platform is being restored from a backup.')).toBeVisible();

  // The banner goes away by itself and the device is back.
  await expect(page.getByText('The platform is being restored from a backup.')).toBeHidden({ timeout: 120_000 });
  await page.goto(`${BASE}/devices/${state.deviceId}`);
  await expect(page.getByRole('heading', { name: 'Tower 17' })).toBeVisible();
  const restored = await fetch(`${BASE}/api/devices/${state.deviceId}`, { headers: { authorization: `Bearer ${await ownerToken()}` } });
  expect(restored.status).toBe(200);
});
