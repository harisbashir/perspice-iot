import { Inject, Injectable } from '@nestjs/common';
import type { BrandingDto } from '@perspice/shared';
import { eq } from 'drizzle-orm';
import { notFound, validation } from '../common/app-error';
import { DB } from '../db/db.module';
import { customer } from '../db/schema';
import { SettingsService } from '../settings/settings.service';
import { contrastRatio } from './palette';
import { sanitizeCss } from './sanitize';

export type BrandingPatch = { [K in keyof BrandingDto]?: BrandingDto[K] | null };

export const MIN_PRIMARY_CONTRAST = 3;

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

  async platformOverrides(): Promise<Partial<BrandingDto>> {
    return (await this.settings.get('platform.branding')) ?? {};
  }

  async customerOverrides(customerId: string): Promise<Partial<BrandingDto>> {
    const row = await this.db.query.customer.findFirst({ where: eq(customer.id, customerId), columns: { branding: true } });
    if (!row) throw notFound();
    return row.branding as Partial<BrandingDto>;
  }

  /** Merge-patches the platform branding; `null` clears a field back to the default. */
  async updatePlatform(patch: BrandingPatch): Promise<BrandingDto> {
    const next = applyPatch(await this.platformOverrides(), patch);
    await this.settings.set('platform.branding', next);
    return this.platform();
  }

  /** Merge-patches a customer's overrides; `null` falls back to the platform value. */
  async updateCustomer(customerId: string, patch: BrandingPatch): Promise<BrandingDto> {
    const next = applyPatch(await this.customerOverrides(customerId), patch);
    await this.db.update(customer).set({ branding: next }).where(eq(customer.id, customerId));
    return this.resolve(customerId);
  }
}

function applyPatch(current: Partial<BrandingDto>, patch: BrandingPatch): Partial<BrandingDto> {
  if (patch.primaryColor) {
    const contrast = contrastRatio(patch.primaryColor, '#FFFFFF');
    if (contrast < MIN_PRIMARY_CONTRAST) {
      throw validation(
        { contrast: Math.round(contrast * 100) / 100, minimum: MIN_PRIMARY_CONTRAST },
        'Primary colour does not have enough contrast against white text',
      );
    }
  }
  const next: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === null || v === '') delete next[k];
    else next[k] = k === 'customCss' ? sanitizeCss(v as string) : v;
  }
  return next as Partial<BrandingDto>;
}
