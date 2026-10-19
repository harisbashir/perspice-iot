import { useBranding } from '@/branding/BrandingProvider';
import { cn } from '@/lib/utils';

/** The tenant's logo, or its product name with a small mark in the brand colour. */
export function Brand({ className }: { className?: string }) {
  const b = useBranding();
  if (b.logoLightUrl) {
    return (
      <span className={cn('flex items-center', className)}>
        <img src={b.logoLightUrl} alt={b.productName} className="h-7 max-w-[10rem] object-contain dark:hidden" />
        <img src={b.logoDarkUrl ?? b.logoLightUrl} alt="" className="hidden h-7 max-w-[10rem] object-contain dark:block" />
      </span>
    );
  }
  return (
    <span className={cn('flex min-w-0 items-center gap-2', className)}>
      <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 shadow-sm">
        <span className="h-2.5 w-2.5 rounded-full border-2 border-white" />
      </span>
      <span className="truncate text-[15px] font-semibold tracking-tight">{b.productName}</span>
    </span>
  );
}
