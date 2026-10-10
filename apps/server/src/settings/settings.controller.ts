import { Body, Controller, Get, HttpCode, Inject, Post, Put } from '@nestjs/common';
import { DEFAULT_MAP_TILES, MapTilesSchema, tileHostAllowed } from '@perspice/shared';
import { CONFIG, type Config } from '../config/config';
import { z } from 'zod';
import { validation } from '../common/app-error';
import { EmailService } from '../email/email.service';
import { Require } from '../rbac/require.decorator';
import { SettingsService } from './settings.service';

const SmtpBody = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().default(''),
  /** Empty keeps the stored password. */
  pass: z.string().default(''),
  from: z.string().min(3),
});

const SesBody = z.object({
  region: z.string().min(1),
  accessKeyId: z.string().min(1),
  /** Empty keeps the stored secret. */
  secretAccessKey: z.string().default(''),
  from: z.string().min(3),
});

const SecurityBody = z.object({
  enforceTotpForSuperAdmin: z.boolean().optional(),
  docsPublic: z.boolean().optional(),
});

const EmailSettingsBody = z.object({
  driver: z.enum(['smtp', 'ses']),
  smtp: SmtpBody.optional(),
  ses: SesBody.optional(),
});

@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly email: EmailService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  @Get('email')
  @Require('system.settings')
  async getEmail() {
    const [driver, smtp, ses] = await Promise.all([
      this.settings.get('email.driver'),
      this.settings.get('email.smtp'),
      this.settings.get('email.ses'),
    ]);
    return {
      driver: driver ?? null,
      smtp: smtp ? { ...smtp, pass: '', hasPassword: smtp.pass.length > 0 } : null,
      ses: ses ? { ...ses, secretAccessKey: '', hasSecret: ses.secretAccessKey.length > 0 } : null,
    };
  }

  @Put('email')
  @Require('system.settings')
  async putEmail(@Body() raw: unknown) {
    const body = EmailSettingsBody.parse(raw);
    if (body.driver === 'smtp' && !body.smtp) throw validation([{ path: ['smtp'], message: 'Required' }]);
    if (body.driver === 'ses' && !body.ses) throw validation([{ path: ['ses'], message: 'Required' }]);
    if (body.smtp) {
      const pass = body.smtp.pass || (await this.settings.get('email.smtp'))?.pass || '';
      await this.settings.set('email.smtp', { ...body.smtp, pass }, { secret: true });
    }
    if (body.ses) {
      const secretAccessKey = body.ses.secretAccessKey || (await this.settings.get('email.ses'))?.secretAccessKey || '';
      await this.settings.set('email.ses', { ...body.ses, secretAccessKey }, { secret: true });
    }
    await this.settings.set('email.driver', body.driver);
    return this.getEmail();
  }

  @Get('security')
  @Require('system.settings')
  async getSecurity() {
    return {
      enforceTotpForSuperAdmin: (await this.settings.get('auth.enforceTotpForSuperAdmin')) ?? true,
      docsPublic: (await this.settings.get('api.docsPublic')) ?? false,
    };
  }

  @Put('security')
  @Require('system.settings')
  async putSecurity(@Body() raw: unknown) {
    const body = SecurityBody.parse(raw);
    if (body.enforceTotpForSuperAdmin !== undefined) await this.settings.set('auth.enforceTotpForSuperAdmin', body.enforceTotpForSuperAdmin);
    if (body.docsPublic !== undefined) await this.settings.set('api.docsPublic', body.docsPublic);
    return this.getSecurity();
  }

  /** Any signed-in user: map widgets need it. */
  @Get('map')
  async map() {
    return (await this.settings.get('map.tiles')) ?? DEFAULT_MAP_TILES;
  }

  @Put('map')
  @Require('system.settings')
  async setMap(@Body() raw: unknown) {
    const tiles = MapTilesSchema.parse(raw);
    if (!tileHostAllowed(tiles.urlTemplate, this.config.MAP_TILE_HOSTS)) {
      throw validation([
        { path: ['urlTemplate'], message: `Browsers would block this tile server: add its host to MAP_TILE_HOSTS in .env (now: ${this.config.MAP_TILE_HOSTS})` },
      ]);
    }
    await this.settings.set('map.tiles', tiles);
    return tiles;
  }

  @Post('email/test')
  @HttpCode(200)
  @Require('system.settings')
  async testEmail(@Body() raw: unknown) {
    const { to } = z.object({ to: z.string().email() }).parse(raw);
    await this.email.sendTest(to);
    return { ok: true };
  }
}
