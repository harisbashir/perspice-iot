import { Inject, Injectable } from '@nestjs/common';
import type { BrandingDto } from '@perspice/shared';
import { eq } from 'drizzle-orm';
import { DB } from '../db/db.module';
import { customer } from '../db/schema';
import { SettingsService } from '../settings/settings.service';

export const DEFAULT_BRANDING: BrandingDto = {
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

/** Overlays non-null fields from `top` onto `base`. */
export function mergeBranding(base: BrandingDto, top: Partial<BrandingDto> | undefined | null): BrandingDto {
  const out: BrandingDto = { ...base };
  for (const [k, v] of Object.entries(top ?? {})) {
    if (v !== null && v !== undefined && v !== '' && k in base) (out as unknown as Record<string, unknown>)[k] = v;
  }
  return out;
}

@Injectable()
export class BrandingService {
  constructor(
    @Inject(DB) private readonly db: DB,
    private readonly settings: SettingsService,
  ) {}

  async platform(): Promise<BrandingDto> {
    return mergeBranding(DEFAULT_BRANDING, await this.settings.get('platform.branding'));
  }

  /** Customer fields override platform fields where non-null. */
  async resolve(customerId: string | null): Promise<BrandingDto> {
    const platform = await this.platform();
    if (!customerId) return platform;
    const row = await this.db.query.customer.findFirst({
      where: eq(customer.id, customerId),
      columns: { branding: true },
    });
    return mergeBranding(platform, row?.branding as Partial<BrandingDto> | undefined);
  }
}
