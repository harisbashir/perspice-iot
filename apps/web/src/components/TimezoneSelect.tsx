import { useMemo } from 'react';
import { cn } from '@/lib/utils';

const zones = (): string[] => {
  const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  return ['UTC', ...list.filter((z) => z !== 'UTC')];
};

export const selectClass = 'h-9 w-full rounded-lg border border-line-strong bg-surface px-2.5 text-sm dark:bg-surface-2/50';

/** IANA timezone picker; `inheritLabel` adds an empty option meaning "use the default". */
export function TimezoneSelect({
  id,
  value,
  onChange,
  inheritLabel,
  className,
}: {
  id?: string;
  value: string | null;
  onChange: (tz: string | null) => void;
  inheritLabel?: string;
  className?: string;
}) {
  const options = useMemo(zones, []);
  return (
    <select id={id} className={cn(selectClass, className)} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      {inheritLabel && <option value="">{inheritLabel}</option>}
      {value && !options.includes(value) && <option value={value}>{value}</option>}
      {options.map((z) => (
        <option key={z} value={z}>
          {z.replace(/_/g, ' ')}
        </option>
      ))}
    </select>
  );
}
