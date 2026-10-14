import { SerialSchema } from '@perspice/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Audited } from '../audit/audited.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { Require } from '../rbac/require.decorator';
import { ClaimService } from '../provisioning/claim.service';
import { ImportService } from '../provisioning/import.service';
import { forbidden, validation } from '../common/app-error';
import { BulkService } from './bulk.service';
import { DevicesService } from './devices.service';

const Tags = z.array(z.string().trim().min(1).max(50)).max(50);
const Timeout = z.number().int().min(10).max(365 * 86400).nullable();

const CreateDevice = z.object({
  name: z.string().trim().min(1).max(200),
  profileId: z.string().uuid(),
  customerId: z.string().uuid().nullish(),
  groupId: z.string().uuid().nullish(),
  tags: Tags.optional(),
  offlineTimeoutS: Timeout.optional(),
  deadTimeoutS: Timeout.optional(),
  serial: SerialSchema.nullish(),
});

const CreateWithClaim = CreateDevice.extend({ withClaimCode: z.boolean().default(false) });

const UpdateDevice = CreateDevice.partial().extend({ disabled: z.boolean().optional() }).strict();

const ListQuery = z.object({
  search: z.string().max(200).optional(),
  /** Devices attached anywhere in this asset's subtree. */
  assetId: z.string().uuid().optional(),
  profileId: z.string().uuid().optional(),
  status: z.enum(['never', 'online', 'offline', 'dead']).optional(),
  customerId: z.string().uuid().optional(),
  tag: z.string().max(50).optional(),
  cursor: z.string().max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

const Attributes = z.record(z.unknown());

@Controller('devices')
export class DevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly bulkOps: BulkService,
    private readonly claims: ClaimService,
    private readonly imports: ImportService,
  ) {}

  /** Devices from a CSV (text/csv body); `dryRun=true` only checks it. Credentials come back once. */
  @Post('import')
  @HttpCode(200)
  @Require('device.write')
  @Audited('device.import', 'device')
  import(@CurrentUser() actor: AuthUser, @Query('dryRun') dryRun: string | undefined, @Req() req: Request) {
    return this.imports.run(actor, req, dryRun === 'true' || dryRun === '1');
  }

  /** A customer admin adds an unassigned device with its claim code. */
  @Post('claim')
  @HttpCode(200)
  @Require('device.claim')
  @Audited('device.claim', 'device')
  claim(@CurrentUser() actor: AuthUser, @Body() raw: unknown) {
    return this.claims.claim(actor, raw);
  }

  /** A new claim code for an unassigned device (the old one stops working). */
  @Post(':id/claim-code')
  @HttpCode(200)
  @Require('device.write')
  @Audited('device.claim_code', 'device')
  async claimCode(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    if (actor.scopeType !== 'platform') throw forbidden('Claim codes are issued by the platform');
    return { claimCode: await this.claims.issue((await this.devices.find(actor, id)).id) };
  }

  /** One action on up to 500 devices; the action's own permission applies (audited by the service). */
  @Post('bulk')
  @HttpCode(200)
  @Require('device.read')
  bulk(@CurrentUser() actor: AuthUser, @Body() raw: unknown, @Req() req: Request) {
    return this.bulkOps.run(actor, raw, req.ip ?? null);
  }

  @Get()
  @Require('device.read')
  list(@CurrentUser() actor: AuthUser, @Query() raw: unknown) {
    return this.devices.list(actor, ListQuery.parse(raw));
  }

  @Get('stats')
  @Require('device.read')
  stats(@CurrentUser() actor: AuthUser) {
    return this.devices.stats(actor);
  }

  @Get(':id')
  @Require('device.read')
  get(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.devices.get(actor, id);
  }

  @Post()
  @Require('device.write')
  @Audited('device.create', 'device')
  async create(@CurrentUser() actor: AuthUser, @Body() raw: unknown) {
    const { withClaimCode, ...input } = CreateWithClaim.parse(raw);
    if (!withClaimCode) return this.devices.create(actor, input);
    // A claim code is for stock: an unassigned device a customer adds later.
    if (actor.scopeType !== 'platform' || input.customerId || input.groupId) {
      throw validation([{ path: ['withClaimCode'], message: 'Only unassigned devices can have a claim code' }]);
    }
    const created = await this.devices.create(actor, input);
    return { ...created, claimCode: await this.claims.issue(created.device.id) };
  }

  @Patch(':id')
  @Require('device.write')
  @Audited('device.update', 'device')
  update(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.devices.update(actor, id, UpdateDevice.parse(raw));
  }

  @Delete(':id')
  @HttpCode(204)
  @Require('device.write')
  @Audited('device.delete', 'device')
  async remove(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    await this.devices.remove(actor, id);
  }

  @Post(':id/credentials/regenerate')
  @Require('device.credentials')
  @Audited('device.credentials_regenerate', 'device')
  regenerate(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.devices.regenerateCredentials(actor, id);
  }

  @Put(':id/attributes/server')
  @Require('device.write')
  @Audited('device.attributes_server', 'device')
  setServer(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.devices.setAttributes(actor, id, 'server', Attributes.parse(raw));
  }

  @Put(':id/attributes/shared')
  @Require('device.write')
  @Audited('device.attributes_shared', 'device')
  setShared(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() raw: unknown) {
    return this.devices.setAttributes(actor, id, 'shared', Attributes.parse(raw));
  }

  @Get(':id/debug')
  @Require('device.read')
  debug(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.devices.debugLog(actor, id);
  }
}
