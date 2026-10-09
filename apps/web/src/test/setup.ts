import '@testing-library/jest-dom/vitest';
import { transferableAbortController } from 'node:util';
import { cleanup, configure } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { fakeSocket } from './fake-socket';
import { server } from './server';

// jsdom installs its own AbortController, but Node's fetch/Request (used by MSW and React
// Router) only accept Node's AbortSignal. Restore Node's implementation.
const nodeController = transferableAbortController();
globalThis.AbortController = nodeController.constructor as typeof AbortController;
globalThis.AbortSignal = nodeController.signal.constructor as typeof AbortSignal;

vi.mock('@/realtime/socket', () => import('./fake-socket'));

// A test's first render loads lazy routes; with the whole suite running in parallel that can
// take longer than Testing Library's default 1 s wait for `findBy*`/`waitFor`.
configure({ asyncUtilTimeout: 3000 });

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
  fakeSocket.reset();
  localStorage.clear();
});
afterAll(() => server.close());
