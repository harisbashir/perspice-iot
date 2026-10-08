import { type BrandingDto } from '@perspice/shared';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, createContext, useContext, useEffect } from 'react';
import { api } from '@/api/client';
import { applyTheme } from './applyTheme';

export const FALLBACK_BRANDING: BrandingDto = {
  productName: 'Perspice IoT',
  logoLightUrl: null,
  logoDarkUrl: null,
  faviconUrl: null,
  primaryColor: '#0F766E',
  accentColor: '#F59E0B',
  loginBackgroundUrl: null,
  supportEmail: null,
  customCss: null,
};

const BrandingContext = createContext<BrandingDto>(FALLBACK_BRANDING);

export const useBranding = () => useContext(BrandingContext);

/** Loads the branding for the current host (platform or customer subdomain) and applies it. */
export function BrandingProvider({ children }: { children: ReactNode }) {
  const { data } = useQuery({
    queryKey: ['public', 'branding'],
    queryFn: () => api<BrandingDto>('/public/branding'),
    staleTime: 5 * 60_000,
  });
  const branding = data ?? FALLBACK_BRANDING;
  useEffect(() => applyTheme(branding), [branding]);
  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}
