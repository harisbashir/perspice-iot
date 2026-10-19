import { arcPath } from './geometry';

/** A small progress ring (a share of a whole), as on the fleet KPI tiles. Decorative: the number beside it says the same. */
export function MiniRing({ fraction, color, size = 36 }: { fraction: number; color: string; size?: number }) {
  const f = Math.max(0, Math.min(1, fraction));
  const c = 18;
  return (
    <svg aria-hidden viewBox="0 0 36 36" width={size} height={size} className="shrink-0">
      <circle cx={c} cy={c} r={14} fill="none" strokeWidth={5} className="stroke-fill-strong" />
      {f > 0 && <path d={arcPath(c, c, 14, 0, f * 360)} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" />}
    </svg>
  );
}
