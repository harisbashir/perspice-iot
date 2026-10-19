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
        <div role="group" aria-label="Confirm" className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-warn-tint p-2 text-xs text-warn">
          <span className="min-w-0 flex-1 basis-32">{confirmText}</span>
          <button type="button" className="h-7 rounded-md px-2.5 font-medium text-fg-2 hover:bg-fill touch:h-9" onClick={() => setPending(null)}>
            Cancel
          </button>
          <button type="button" className="h-7 rounded-md bg-primary-600 px-2.5 font-medium text-white hover:bg-primary-700 touch:h-9" onClick={() => void run(pending)}>
            Confirm
          </button>
        </div>
      )}
      {message && (
        <p role="status" className={`mt-1 text-xs font-medium ${message.ok ? 'text-ok' : 'text-crit'}`}>
          {message.text}
        </p>
      )}
    </>
  );

  return { trigger, busy, ui };
}

export const buttonClass =
  'inline-flex h-9 w-full items-center justify-center rounded-lg bg-primary-600 px-4 text-sm font-medium text-white shadow-sm transition active:scale-[0.98] hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-40 touch:h-11 @[16rem]:w-auto';

export function parseParams(text: string | undefined): Record<string, unknown> {
  if (!text?.trim()) return {};
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
