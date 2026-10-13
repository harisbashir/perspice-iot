import { type Browser, type BrowserContext, type Page, expect, test } from '@playwright/test';
import { connectDevice, linkIn, saveState, totp, waitForEmail } from './fixtures';

const BASE = process.env.E2E_BASE_URL ?? 'https://localhost:18443';
const ACME = BASE.replace('://localhost', '://acme.localhost');
const OWNER = 'owner@perspice.test';
const CUSTOMER_ADMIN = 'ops@acme.test';
const PASSWORD = 'e2e-password-123';

test.describe.configure({ mode: 'serial' });

let platform: Page;
let customer: Page;
let customerContext: BrowserContext;
let totpSecret = '';
let deviceId = '';
let deviceToken = '';
let device: Awaited<ReturnType<typeof connectDevice>> | undefined;

async function signIn(page: Page, base: string, email: string, password: string, code?: () => string) {
  await page.goto(`${base}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (code) {
    await page.getByLabel('Authentication code').fill(code());
    await page.getByRole('button', { name: 'Verify' }).click();
  }
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}

async function apiToken(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: OWNER, password: PASSWORD, totp: totp(totpSecret) }),
  });
  return ((await res.json()) as { accessToken: string }).accessToken;
}

async function newContext(browser: Browser) {
  return browser.newContext({ ignoreHTTPSErrors: true });
}

test.beforeAll(() => {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // Caddy's internal CA for *.localhost
});

test.afterAll(async () => {
  await device?.client.endAsync(true);
});

test('super admin activates via the emailed link, enrols TOTP and signs in', async ({ browser }) => {
  platform = await (await newContext(browser)).newPage();
  const link = linkIn(await waitForEmail(OWNER, 'invited'), '/activate?token');
  await platform.goto(link);
  await platform.getByLabel('New password').fill(PASSWORD);
  await platform.getByLabel('Confirm password').fill(PASSWORD);
  await platform.getByRole('button', { name: 'Activate' }).click();
  await expect(platform.getByText('Your account is ready.')).toBeVisible();

  // Super admins must enrol two-factor authentication before anything else.
  await signIn(platform, BASE, OWNER, PASSWORD);
  await expect(platform).toHaveURL(/\/settings\/profile$/);
  await platform.getByRole('button', { name: /set up two-factor/i }).click();
  await expect(platform.getByAltText('QR code for your authenticator app')).toBeVisible();
  totpSecret = (await platform.locator('code').first().textContent())!.trim();
  await platform.getByLabel('Code').fill(totp(totpSecret));
  await platform.getByRole('button', { name: 'Turn on' }).click();
  await expect(platform.getByText('Two-factor authentication is on.')).toBeVisible();
  saveState({ totpSecret });

  await platform.getByRole('button', { name: 'Account menu' }).click();
  await platform.getByRole('menuitem', { name: 'Sign out' }).click();
  // Let sign-out finish before signing in again (otherwise the old session can still redirect).
  await expect(platform).toHaveURL(/\/login/);
  await signIn(platform, BASE, OWNER, PASSWORD, () => totp(totpSecret));
  await expect(platform.getByRole('heading', { name: 'Overview' })).toBeVisible();
});

test('creates customer acme with blue branding and invites its admin, who sees the theme', async ({ browser }) => {
  await platform.getByRole('link', { name: 'Customers' }).click();
  await platform.getByRole('button', { name: 'New customer' }).click();
  const create = platform.getByRole('dialog');
  await create.getByLabel('Name', { exact: true }).fill('Acme');
  await expect(create.getByLabel('Subdomain')).toHaveValue('acme');
  await create.getByRole('button', { name: 'Create customer' }).click();
  await platform.getByRole('link', { name: 'Acme' }).click();
  await platform.getByRole('tab', { name: 'Branding' }).click();
  await platform.getByLabel('Primary colour', { exact: true }).fill('#1D4ED8');
  await platform.getByRole('button', { name: 'Save branding' }).click();
  await expect(platform.getByText('Saved')).toBeVisible();

  await platform.getByRole('link', { name: 'Users' }).click();
  await platform.getByRole('button', { name: 'Invite user' }).click();
  const invite = platform.getByRole('dialog');
  await invite.getByLabel('Email', { exact: true }).fill(CUSTOMER_ADMIN);
  await invite.getByLabel('Name', { exact: true }).fill('Acme Ops');
  await invite.getByLabel('Role', { exact: true }).selectOption({ label: 'Customer Admin (customer)' });
  await invite.getByLabel('Customer', { exact: true }).selectOption({ label: 'Acme' });
  await invite.getByRole('button', { name: 'Send invite' }).click();
  // The link is also shown for copying, for servers without email.
  const shared = platform.getByRole('dialog', { name: 'Share the invite' });
  const shownLink = await shared.getByLabel('Invite link', { exact: true }).inputValue();
  await platform.keyboard.press('Escape');
  await expect(shared).toBeHidden();
  await expect(platform.getByRole('cell', { name: CUSTOMER_ADMIN, exact: true })).toBeVisible();

  const link = linkIn(await waitForEmail(CUSTOMER_ADMIN, 'invited'), '/activate?token');
  expect(link.startsWith(ACME)).toBe(true);
  expect(shownLink).toBe(link);
  customerContext = await newContext(browser);
  customer = await customerContext.newPage();
  await customer.goto(link);
  await customer.getByLabel('New password').fill(PASSWORD);
  await customer.getByLabel('Confirm password').fill(PASSWORD);
  await customer.getByRole('button', { name: 'Activate' }).click();
  await expect(customer.getByText('Your account is ready.')).toBeVisible();
  await signIn(customer, ACME, CUSTOMER_ADMIN, PASSWORD);
  const primary = await customer.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-primary-500').trim());
  expect(primary).toBe('29 78 216');
});

test('a Telecom RMS device for acme shows live fuel level within 2 s', async () => {
  await platform.getByRole('link', { name: 'Devices' }).click();
  await platform.getByRole('button', { name: 'New device' }).click();
  const form = platform.getByRole('dialog');
  await form.getByLabel('Name', { exact: true }).fill('Tower 17');
  await form.getByLabel('Profile', { exact: true }).selectOption({ label: 'Telecom RMS' });
  await form.getByLabel('Customer', { exact: true }).selectOption({ label: 'Acme' });
  await form.getByRole('button', { name: 'Create device' }).click();
  deviceToken = (await platform.getByTestId('device-token').textContent())!.trim();
  const snippet = await platform.locator('pre').first().textContent();
  deviceId = /deviceId = "([0-9a-f-]{36})"/.exec(snippet ?? '')![1]!;
  await platform.getByRole('button', { name: 'Done' }).click();
  await expect(platform.getByTestId('device-token')).toHaveCount(0);

  saveState({ deviceId, deviceToken });

  device = await connectDevice(deviceId, deviceToken);
  await customer.goto(`${ACME}/devices/${deviceId}`);
  await expect(customer.getByText('Online', { exact: true })).toBeVisible();
  await customer.getByRole('tab', { name: 'Overview' }).click(); // devices open on their dashboard
  await device.publish({ fuel_level: 71.25, mains_v: 231 });
  await expect(customer.getByTestId('value-fuel_level')).toHaveText('71.3 %', { timeout: 2000 });
});

test('customer admin starts the generator after confirming and sees success', async () => {
  await customer.getByRole('tab', { name: 'Commands' }).click();
  await customer.getByRole('group', { name: 'Start generator' }).getByRole('button', { name: 'Send' }).click();
  await customer.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(customer.getByRole('cell', { name: 'success', exact: true })).toBeVisible();
});

test('when the device stops, it shows Offline, emails the customer admin and rings the bell', async () => {
  await device!.client.endAsync();
  device = undefined;
  await customer.getByRole('tab', { name: 'Overview' }).click();
  await expect(customer.getByText('Offline', { exact: true })).toBeVisible({ timeout: 45_000 });
  const mail = await waitForEmail(CUSTOMER_ADMIN, 'Device offline: Tower 17');
  expect(mail).toContain(`${ACME}/devices/${deviceId}`);
  await expect(customer.getByRole('button', { name: /Notifications \([1-9]\d* unread\)/ })).toBeVisible();
});

test("customer admin cannot open another customer's device", async () => {
  const token = await apiToken();
  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const beta = (await (await fetch(`${BASE}/api/customers`, { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Beta', slug: 'beta' }) })).json()) as {
    id: string;
  };
  const profiles = (await (await fetch(`${BASE}/api/device-profiles`, { headers: auth })).json()) as { id: string; name: string }[];
  const created = (await (
    await fetch(`${BASE}/api/devices`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: 'Beta site', profileId: profiles[0]!.id, customerId: beta.id }),
    })
  ).json()) as { device: { id: string } };
  await customer.goto(`${ACME}/devices/${created.device.id}`);
  await expect(customer.getByRole('heading', { name: 'Not found' })).toBeVisible();
});
