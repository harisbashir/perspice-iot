import { type ReactNode, useId } from 'react';
import { Label } from './label';

/** Label + control + error/help text, with ids wired for accessibility. */
export function Field({
  label,
  error,
  help,
  children,
}: {
  label: string;
  error?: string | null;
  help?: string;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}) {
  const id = useId();
  const msgId = `${id}-msg`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children(id, error || help ? msgId : undefined)}
      {error ? (
        <p id={msgId} role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : help ? (
        <p id={msgId} className="text-sm text-slate-500">
          {help}
        </p>
      ) : null}
    </div>
  );
}
