import { useEffect, useRef, useState } from 'react';

/**
 * A reading: the number large in the rounded face, its unit smaller beside it. When the value
 * changes it glows once in the brand colour (the "live pulse"; off with reduced motion), so a
 * reading that just arrived is noticed without moving anything.
 *
 * `size` scales with the widget's width through container queries (WidgetFrame is a container).
 */
export function Readout({
  text,
  unit,
  size = 'lg',
  className = '',
  testId,
}: {
  text: string;
  unit?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  testId?: string;
}) {
  const pulse = usePulse(text);
  const sizes = {
    sm: 'text-xl',
    md: 'text-2xl @[12rem]:text-3xl',
    lg: 'text-[28px] @[12rem]:text-4xl @[20rem]:text-5xl',
  };
  return (
    <span data-testid={testId} className={`font-rounded font-semibold leading-none tracking-tight tabular-nums ${sizes[size]} ${pulse ? 'animate-live' : ''} ${className}`}>
      {text}
      {unit && <span className="text-[0.5em] font-medium tracking-normal text-fg-muted"> {unit}</span>}
    </span>
  );
}

/** True for a moment after `value` changes (not on first render). */
export function usePulse(value: unknown): boolean {
  const first = useRef(true);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setOn(true);
    const t = setTimeout(() => setOn(false), 1200);
    return () => clearTimeout(t);
  }, [value]);
  return on;
}

/** "64.6 %" → { text: "64.6", unit: "%" } for values formatted with a unit. */
export function splitUnit(formatted: string, unit?: string): { text: string; unit?: string } {
  if (unit && formatted.endsWith(` ${unit}`)) return { text: formatted.slice(0, -unit.length - 1), unit };
  return { text: formatted };
}
