import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

/** Starts the mock API in the browser (demo mode only; `pnpm --filter @perspice/web dev:demo`). */
export async function startDemo(): Promise<void> {
  await setupWorker(...handlers).start({ onUnhandledFrame: 'bypass', quiet: true });
}
