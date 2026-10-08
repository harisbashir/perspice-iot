import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Audited } from '../audit/audited.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Public } from '../auth/decorators';
import { forbidden, notFound, validation } from '../common/app-error';
import { CustomersService } from '../customers/customers.service';
import { Require } from '../rbac/require.decorator';
import { STORAGE, type StorageDriver } from '../storage/storage.driver';
import { BrandingService } from './branding.service';
import { HEX_COLOR } from './palette';
import { sanitizeSvg } from './sanitize';

export const MAX_ASSET_BYTES = 1024 * 1024;

const AssetUrl = z
  .string()
  .max(2000)
  .refine((v) => v.startsWith('/api/public/assets/') || /^https:\/\//.test(v), 'Must be an uploaded asset or https URL');

const BRANDING_FIELDS = {
  productName: z.string().trim().min(1).max(100),
  logoLightUrl: AssetUrl,
  logoDarkUrl: AssetUrl,
  faviconUrl: AssetUrl,
  loginBackgroundUrl: AssetUrl,
  primaryColor: z.string().regex(HEX_COLOR),
  accentColor: z.string().regex(HEX_COLOR),
  supportEmail: z.string().email().max(254),
  customCss: z.string().max(50_000),
};

/** Merge patch: omitted fields are kept, `null` clears a field. */
const BrandingPatchBody = z
  .object(
    Object.fromEntries(Object.entries(BRANDING_FIELDS).map(([k, v]) => [k, v.nullable().optional()])) as {
      [K in keyof typeof BRANDING_FIELDS]: z.ZodOptional<z.ZodNullable<(typeof BRANDING_FIELDS)[K]>>;
    },
  )
  .strict();

const ASSET_TYPES: Record<string, { ext: string; magic?: Buffer }> = {
  'image/png': { ext: 'png', magic: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
  'image/svg+xml': { ext: 'svg' },
  'image/x-icon': { ext: 'ico', magic: Buffer.from([0, 0, 1, 0]) },
  'image/vnd.microsoft.icon': { ext: 'ico', magic: Buffer.from([0, 0, 1, 0]) },
};

@Controller()
export class BrandingController {
  constructor(
    private readonly branding: BrandingService,
    private readonly customers: CustomersService,
    @Inject(STORAGE) private readonly storage: StorageDriver,
  ) {}

  /** Branding for the requesting host; unknown hosts get the platform branding. */
  @Get('public/branding')
  @Public()
  publicBranding(@Req() req: Request) {
    const host = req.tenantHost;
    return this.branding.resolve(host?.kind === 'customer' ? host.customerId : null);
  }

  @Get('branding/platform')
  @Require('branding.edit')
  async getPlatform(@CurrentUser() actor: AuthUser) {
    if (actor.scopeType !== 'platform') throw forbidden();
    return { overrides: await this.branding.platformOverrides(), effective: await this.branding.platform() };
  }

  @Put('branding/platform')
  @Require('branding.edit')
  @Audited('branding.platform_update', 'branding')
  updatePlatform(@CurrentUser() actor: AuthUser, @Body() raw: unknown) {
    if (actor.scopeType !== 'platform') throw forbidden();
    return this.branding.updatePlatform(BrandingPatchBody.parse(raw));
  }

  @Get('customers/:id/branding')
  @Require('branding.edit')
  async getCustomer(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    await this.customers.assertCustomerAccess(actor, id);
    return { overrides: await this.branding.customerOverrides(id), effective: await this.branding.resolve(id) };
  }

  @Put('customers/:id/branding')
  @Require('branding.edit')
  @Audited('branding.customer_update', 'customer')
  async updateCustomer(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    await this.customers.assertCustomerAccess(actor, id);
    return this.branding.updateCustomer(id, BrandingPatchBody.parse(raw));
  }

  @Post('branding/assets')
  @Require('branding.edit')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ASSET_BYTES, files: 1 } }))
  async upload(@CurrentUser() actor: AuthUser, @UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw validation([{ path: ['file'], message: 'Required' }]);
    const type = ASSET_TYPES[file.mimetype];
    if (!type) throw validation([{ path: ['file'], message: 'Use PNG, SVG or ICO' }]);
    let body = file.buffer;
    if (type.magic && !body.subarray(0, type.magic.length).equals(type.magic)) {
      throw validation([{ path: ['file'], message: 'File content does not match its type' }]);
    }
    if (type.ext === 'svg') body = Buffer.from(sanitizeSvg(body.toString('utf8')));
    const owner = actor.scopeType === 'customer' ? actor.customerId! : 'platform';
    const key = `branding/${owner}/${randomUUID()}.${type.ext}`;
    await this.storage.put(key, body, file.mimetype);
    return { url: `/api/public/assets/${key}` };
  }

  /** Branding assets must load on the login page, so they are public (names are unguessable). */
  @Get('public/assets/*key')
  @Public()
  async asset(@Param('key') keyParts: string | string[], @Res() res: Response) {
    const key = Array.isArray(keyParts) ? keyParts.join('/') : keyParts;
    if (!key.startsWith('branding/')) throw notFound();
    const obj = await this.storage.get(key).catch(() => {
      throw notFound();
    });
    res.setHeader('content-type', obj.contentType);
    res.setHeader('cache-control', 'public, max-age=86400, immutable');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'");
    res.send(obj.body);
  }
}
