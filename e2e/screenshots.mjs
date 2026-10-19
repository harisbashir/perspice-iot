// Screenshots of the web app's main pages at phone and desktop widths, light and dark, for
// checking UI changes. Run against demo mode, which needs no server:
//
//   pnpm --filter @perspice/web dev:demo            # in another terminal
//   node e2e/screenshots.mjs [baseUrl] [outDir] [filter]
//
// `filter` keeps only shots whose file name contains it (e.g. "phone-light"). ALL=1 adds the
// remaining sections (mostly empty in demo mode, but their layout and empty states show).
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = process.argv[3] ?? 'screenshots';
const filter = process.argv[4] ?? '';

// A Telecom RMS site from the demo fixtures (src/demo/fixtures.ts).
const RMS_DEVICE = '5d2a0c00-0000-4000-8000-000000000001';
const PAGES = [
  ['overview', '/'],
  ['devices', '/devices'],
  ['device', `/devices/${RMS_DEVICE}`],
  ['alarms', '/alarms'],
  ['settings', '/settings/profile'],
  ['help', '/help'],
  ['login', '/login'],
  ...(process.env.ALL
    ? [
        ['assets', '/assets'],
        ['alarm-rules', '/alarm-rules'],
        ['profiles', '/profiles'],
        ['profile-editor', '/profiles/0b9e7f80-0000-4000-8000-000000000001'],
        ['dashboards', '/dashboards'],
        ['customers', '/customers'],
        ['users', '/users'],
        ['firmware', '/firmware'],
        ['system', '/system'],
        ['audit', '/audit'],
        ['reports', '/reports'],
        ['geofences', '/geofences'],
        ['alarm', '/alarms/a1a1a1a1-0000-4000-8000-000000000002'],
        ['notifications', '/settings/notifications'],
      ]
    : []),
];
const VIEWPORTS = [
  ['phone', { width: 390, height: 844 }, true],
  ['desktop', { width: 1440, height: 900 }, false],
];

mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  for (const [vp, viewport, isMobile] of VIEWPORTS) {
    const context = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, deviceScaleFactor: 1, colorScheme: theme });
    await context.addInitScript((t) => localStorage.setItem('perspice.theme', t), theme);
    const page = await context.newPage();
    page.on('pageerror', (e) => console.error(`[${vp}] page error:`, e.stack ?? e.message));
    for (const [name, path] of PAGES) {
      const file = `${out}/${name}-${vp}-${theme}.png`;
      if (filter && !file.includes(filter)) continue;
      await page.goto(base + path, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1200); // charts animate in
      await page.screenshot({ path: file, fullPage: true });
      console.log(file);
    }
    await context.close();
  }
}
await browser.close();
