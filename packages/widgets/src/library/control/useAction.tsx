import { useState } from 'react';

/**
 * Runs a control action with an optional inline confirmation step and reports errors.
 * Returns the confirmation UI to render below the control.
 */
export function useAction(confirmText: string) {
  const [pending, setPending] = useState<null | (() => Promise<void>)>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      setMessage({ ok: true, text: 'Sent' });
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message || 'Failed' });
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  const trigger = (fn: () => Promise<void>, confirm: boolean) => (confirm ? setPending(() => fn) : void run(fn));

  const ui = (
    <>
      {pending && (
        <div role="group" aria-label="Confirm" className="mt-2 flex items-center gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <span className="flex-1">{confirmText}</span>
          <button type="button" className="rounded px-2 py-1 hover:bg-amber-100 dark:hover:bg-amber-900" onClick={() => setPending(null)}>
            Cancel
          </button>
          <button type="button" className="rounded bg-primary-600 px-2 py-1 font-medium text-white hover:bg-primary-700" onClick={() => void run(pending)}>
            Confirm
          </button>
        </div>
      )}
      {message && (
        <p role="status" className={`mt-1 text-xs ${message.ok ? 'text-green-700 dark:text-green-400' : 'text-red-600'}`}>
          {message.text}
        </p>
      )}
    </>
  );

  return { trigger, busy, ui };
}

export const buttonClass =
  'inline-flex h-9 items-center justify-center rounded-md bg-primary-600 px-4 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50';

export function parseParams(text: string | undefined): Record<string, unknown> {
  if (!text?.trim()) return {};
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
