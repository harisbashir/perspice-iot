import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'https://localhost:18443',
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'core', testMatch: 'core-flow.spec.ts' },
    // Builds on the state the core flow leaves behind; `--project=dashboards` runs core first.
    { name: 'dashboards', testMatch: 'dashboards.spec.ts', dependencies: ['core'] },
    { name: 'alarms', testMatch: 'alarms.spec.ts', dependencies: ['dashboards'] },
    // Restores a backup, so it runs after everything else that shares the stack.
    { name: 'operations', testMatch: 'operations.spec.ts', dependencies: ['alarms'] },
    { name: 'location', testMatch: 'location.spec.ts', dependencies: ['operations'] },
    { name: 'fleet', testMatch: 'fleet.spec.ts', dependencies: ['location'] },
    { name: 'energy', testMatch: 'energy.spec.ts', dependencies: ['fleet'] },
    { name: 'live', testMatch: 'live.spec.ts' },
  ],
});
