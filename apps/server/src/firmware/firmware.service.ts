import { Inject, Injectable } from '@nestjs/common';
import { FIRMWARE_MAX_BYTES, type FirmwareDto, FirmwareUploadSchema } from '@perspice/shared';
import { and, asc, desc, eq } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { type Readable, Transform } from 'node:stream';
import type { AuthUser } from '../auth/auth.types';
import { conflict, notFound, tooLarge, validation } from '../common/app-error';
import { DB } from '../db/db.module';
import { isUuid } from '../db/scoped-repo';
import { deviceProfile, firmware, otaJob } from '../db/schema';
import { STORAGE, type StorageDriver } from '../storage/storage.driver';

type Row = typeof firmware.$inferSelect;

export const toFirmwareDto = (r: Row): FirmwareDto => ({
  id: r.id,
  profileId: r.profileId,
  version: r.version,
  size: r.size,
  sha256: r.sha256,
  notes: r.notes,
  createdAt: r.createdAt.getTime(),
});

class TooLarge extends Error {}

/** Firmware images (platform-managed, per profile). */
@Injectable()
export class FirmwareService {
  constructor(
    @Inject(DB) private readonly db: DB,
    @Inject(STORAGE) private readonly storage: StorageDriver,
  ) {}

  async upload(actor: AuthUser, query: unknown, body: Readable): Promise<FirmwareDto> {
    const meta = FirmwareUploadSchema.parse(query);
    if (!(await this.db.query.deviceProfile.findFirst({ where: eq(deviceProfile.id, meta.profileId), columns: { id: true } }))) throw notFound();
    const taken = await this.db.query.firmware.findFirst({ where: and(eq(firmware.profileId, meta.profileId), eq(firmware.version, meta.version)) });
    if (taken) throw conflict(`Version ${meta.version} already exists for this profile`);

    const id = randomUUID();
    const key = `firmware/${id}.bin`;
    const hash = createHash('sha256');
    let size = 0;
    // Hashes and counts on the way to storage, stopping at the size limit.
    const meter = new Transform({
      transform(chunk: Buffer, _e, cb) {
        size += chunk.length;
        if (size > FIRMWARE_MAX_BYTES) return cb(new TooLarge());
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    body.on('error', (err) => meter.destroy(err));
    body.pipe(meter);
    try {
      await this.storage.putStream(key, meter, 'application/octet-stream');
    } catch (err) {
      body.unpipe(meter);
      body.resume(); // drain the rest of the request
      await this.storage.delete(key).catch(() => undefined);
      if (err instanceof TooLarge) throw tooLarge(`Firmware images can be at most ${FIRMWARE_MAX_BYTES / 1024 / 1024} MB`);
      throw err;
    }
    if (size === 0) {
      await this.storage.delete(key).catch(() => undefined);
      throw validation([{ path: ['body'], message: 'The image is empty' }]);
    }
    try {
      const [row] = await this.db
        .insert(firmware)
        .values({ id, profileId: meta.profileId, version: meta.version, notes: meta.notes, fileKey: key, sha256: hash.digest('hex'), size, createdBy: actor.id })
        .returning();
      return toFirmwareDto(row!);
    } catch (err) {
      await this.storage.delete(key).catch(() => undefined);
      if ((err as { code?: string }).code === '23505') throw conflict(`Version ${meta.version} already exists for this profile`);
      throw err;
    }
  }

  async list(profileId?: string): Promise<FirmwareDto[]> {
    const rows = await this.db
      .select()
      .from(firmware)
      .where(profileId ? eq(firmware.profileId, profileId) : undefined)
      .orderBy(asc(firmware.profileId), desc(firmware.createdAt))
      .limit(1000);
    return rows.map(toFirmwareDto);
  }

  async find(id: string): Promise<Row> {
    if (!isUuid(id)) throw notFound();
    const row = await this.db.query.firmware.findFirst({ where: eq(firmware.id, id) });
    if (!row) throw notFound();
    return row;
  }

  /** A signed link to the image, valid for `ttlS` seconds. */
  async downloadUrl(id: string, ttlS = 300): Promise<string> {
    return this.storage.getSignedUrl((await this.find(id)).fileKey, ttlS);
  }

  async remove(id: string): Promise<void> {
    const row = await this.find(id);
    if (await this.db.query.otaJob.findFirst({ where: eq(otaJob.firmwareId, row.id), columns: { id: true } })) {
      throw conflict('This firmware has been rolled out; it is kept with its updates');
    }
    await this.db.delete(firmware).where(eq(firmware.id, row.id));
    await this.storage.delete(row.fileKey).catch(() => undefined);
  }
}
