import { Public } from '../auth/decorators';
import { Controller, Get, Inject, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { notFound } from '../common/app-error';
import { CONFIG, type Config } from '../config/config';
import { verifySignedUrl } from './local.driver';
import { STORAGE, type StorageDriver } from './storage.driver';

@Public()
@Controller('files')
export class FilesController {
  constructor(
    @Inject(STORAGE) private readonly storage: StorageDriver,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  /** Serves objects behind HMAC-signed, expiring URLs produced by `getSignedUrl`. */
  @Get('*key')
  async get(
    @Param('key') keyParts: string | string[],
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ) {
    const key = Array.isArray(keyParts) ? keyParts.join('/') : keyParts;
    if (!exp || !sig || !verifySignedUrl(this.config.JWT_SECRET, key, exp, sig)) throw notFound();
    const obj = await this.storage.getStream(key).catch(() => {
      throw notFound();
    });
    res.setHeader('content-type', obj.contentType);
    res.setHeader('content-length', String(obj.size));
    res.setHeader('cache-control', 'private, max-age=300');
    res.setHeader('x-content-type-options', 'nosniff');
    // Exports are downloads, named after the last key segment.
    if (key.startsWith('exports/')) res.setHeader('content-disposition', `attachment; filename="${key.split('/').pop()}"`);
    await pipeline(obj.body, res);
  }
}
