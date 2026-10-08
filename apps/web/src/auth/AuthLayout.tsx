import type { ReactNode } from 'react';
import { useBranding } from '@/branding/BrandingProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** Branded centered card used by login, forgot, reset and activate pages. */
export function AuthLayout({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const b = useBranding();
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-slate-50 bg-cover bg-center p-4 dark:bg-slate-950"
      style={b.loginBackgroundUrl ? { backgroundImage: `url(${b.loginBackgroundUrl})` } : undefined}
    >
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          {b.logoLightUrl ? (
            <img src={b.logoLightUrl} alt={b.productName} className="mb-2 h-10 dark:hidden" />
          ) : (
            <div className="mb-2 text-xl font-bold text-primary-700 dark:text-primary-300">{b.productName}</div>
          )}
          {b.logoDarkUrl && <img src={b.logoDarkUrl} alt={b.productName} className="mb-2 hidden h-10 dark:block" />}
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  );
}
