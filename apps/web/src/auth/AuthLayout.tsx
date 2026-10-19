import type { ReactNode } from 'react';
import { useBranding } from '@/branding/BrandingProvider';
import { Brand } from '@/layout/Brand';

/**
 * The sign-in, forgot, reset and activate pages: a card on the canvas over faint concentric rings
 * in the brand colour (the dashboards' ring gauges), or over the tenant's own background image.
 */
export function AuthLayout({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const b = useBranding();
  return (
    <div
      className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-canvas bg-cover bg-center px-4 py-10"
      style={b.loginBackgroundUrl ? { backgroundImage: `url(${b.loginBackgroundUrl})` } : undefined}
    >
      {!b.loginBackgroundUrl && (
        <svg aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-[64rem] w-[64rem] -translate-x-1/2 -translate-y-1/2 text-primary-500" viewBox="0 0 100 100">
          {[48, 38, 28, 18].map((r, i) => (
            <circle key={r} cx={50} cy={50} r={r} fill="none" stroke="currentColor" strokeWidth={0.35} opacity={0.07 + i * 0.03} strokeDasharray={i % 2 ? '1 2' : undefined} />
          ))}
        </svg>
      )}
      <div className="relative w-full max-w-[22rem]">
        <div className="mb-6 flex justify-center">
          <Brand className="[&_span]:text-lg" />
        </div>
        <div className="rounded-2xl bg-surface p-6 shadow-float sm:p-7 dark:bg-surface-2">
          <div className="mb-5 text-center">
            <h1 className="text-[22px] font-bold tracking-tight">{title}</h1>
            {description && <p className="mt-1.5 text-sm text-fg-muted">{description}</p>}
          </div>
          {children}
        </div>
        {b.supportEmail && (
          <p className="mt-6 text-center text-xs text-fg-muted">
            Need help? <a className="text-primary-700 hover:underline dark:text-primary-300" href={`mailto:${b.supportEmail}`}>{b.supportEmail}</a>
          </p>
        )}
      </div>
    </div>
  );
}
