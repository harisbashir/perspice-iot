import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { Audited } from '../audit/audited.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { forbidden } from '../common/app-error';
import { Require } from '../rbac/require.decorator';
import { AssetTypesService } from './asset-types.service';
import { AssetsService } from './assets.service';

const platformOnly = (actor: AuthUser) => {
  if (actor.scopeType !== 'platform') throw forbidden('Asset types are managed by the platform');
};

@Controller()
export class AssetsController {
  constructor(
    private readonly types: AssetTypesService,
    private readonly assets: AssetsService,
  ) {}

  @Get('asset-types')
  @Require('asset.read')
  listTypes() {
    return this.types.list();
  }

  @Post('asset-types')
  @Require('asset.type.manage')
  @Audited('asset_type.create', 'asset_type')
  createType(@CurrentUser() actor: AuthUser, @Body() body: unknown) {
    platformOnly(actor);
    return this.types.create(body);
  }

  @Patch('asset-types/:id')
  @Require('asset.type.manage')
  @Audited('asset_type.update', 'asset_type')
  updateType(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    platformOnly(actor);
    return this.types.update(id, body);
  }

  @Delete('asset-types/:id')
  @HttpCode(204)
  @Require('asset.type.manage')
  @Audited('asset_type.delete', 'asset_type', { targetIdFrom: 'param' })
  async removeType(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    platformOnly(actor);
    await this.types.remove(id);
  }

  /** Every asset in scope (flat) with device and alarm roll-ups; platform users may name a customer. */
  @Get('assets/tree')
  @Require('asset.read')
  tree(@CurrentUser() actor: AuthUser, @Query('customerId') customerId?: string) {
    return this.assets.tree(actor, customerId);
  }

  @Get('assets/:id')
  @Require('asset.read')
  get(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.assets.get(actor, id);
  }

  @Post('assets')
  @Require('asset.write')
  @Audited('asset.create', 'asset')
  create(@CurrentUser() actor: AuthUser, @Body() body: unknown) {
    return this.assets.create(actor, body);
  }

  @Patch('assets/:id')
  @Require('asset.write')
  @Audited('asset.update', 'asset')
  update(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.assets.update(actor, id, body);
  }

  @Delete('assets/:id')
  @HttpCode(204)
  @Require('asset.write')
  @Audited('asset.delete', 'asset', { targetIdFrom: 'param' })
  async remove(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    await this.assets.remove(actor, id);
  }

  /** `depth=children` for devices attached directly; the whole subtree by default. */
  @Get('assets/:id/devices')
  @Require('device.read')
  devices(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Query() query: unknown) {
    return this.assets.devicesOf(actor, id, query);
  }

  @Get('devices/:id/asset')
  @Require('device.read')
  assetOf(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.assets.assetOf(actor, id);
  }

  @Put('devices/:id/asset')
  @Require('asset.write')
  @Audited('device.asset', 'device', { targetIdFrom: 'param' })
  attach(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.assets.attach(actor, id, body);
  }
}
