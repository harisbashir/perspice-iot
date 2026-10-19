/** The unacknowledged-alarm count on the Alarms item. */
export function NavBadge({ count, className = '' }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span aria-label={`${count} unacknowledged`} className={`min-w-[1.125rem] rounded-full bg-crit-vivid px-1 text-center text-[11px] font-semibold leading-[1.125rem] text-white ${className}`}>
      {count > 99 ? '99+' : count}
    </span>
  );
}
