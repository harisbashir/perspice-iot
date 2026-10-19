import { Inject, Injectable } from '@nestjs/common';
import {
  type DeviceLocationDto,
  ErrorCode,
  IMPORT_COLUMNS,
  IMPORT_MAX_ROWS,
  type ImportReport,
  ImportRowSchema,
  formatClaimCode,
  parseCsv,
} from '@perspice/shared';
import { inArray } from 'drizzle-orm';
import type Redis from 'ioredis';
import type { Readable } from 'node:stream';
import type { AuthUser } from '../auth/auth.types';
import { AppError, forbidden, validation } from '../common/app-error';
import { REDIS } from '../common/redis.module';
import { ensureDeviceDashboard } from '../dashboards/assignment';
import { DB } from '../db/db.module';
import { customer, customerGroup, device, deviceClaim, deviceProfile } from '../db/schema';
import { CredentialsService } from '../devices/credentials.service';
import { locationKey } from '../location/location.service';
import { hashClaimCode, newClaimCode } from './claim.service';

const MAX_BYTES = 2 * 1024 * 1024;

interface Planned {
  name: string;
  profileId: string;
  customerId: string | null;
  groupId: string | null;
  tags: string[];
  location: DeviceLocationDto | null;
  claim: boolean;
  serial: string | null;
  /** 1-based data row, for errors found after the rows are planned. */
  row: number;
}

type Issue = ImportReport['errors'][number];

/**
 * Device import from CSV (spec §11): every row is checked first (names resolve to profiles,
 * customers and groups); a file with any error creates nothing. Devices are then created in one
 * transaction, and their credentials returned once.
 */
@Injectable()
export class ImportService {
  constructor(
    @Inject(DB) private readonly db: DB,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly credentials: CredentialsService,
  ) {}

  async run(actor: AuthUser, body: Readable, dryRun: boolean): Promise<ImportReport> {
    if (actor.scopeType !== 'platform') throw forbidden('Devices are imported by the platform; customers use claim codes');
    const { rows, errors } = await this.plan(await readText(body));
    if (dryRun) return { ok: errors.length === 0, rows: rows.length + countBad(errors), errors };
    if (errors.length) throw new AppError(ErrorCode.VALIDATION, 'The file has errors; nothing was imported', 400, { errors });

    const created: NonNullable<ImportReport['created']> = [];
    const locations: [string, DeviceLocationDto][] = [];
    await this.db.transaction(async (tx) => {
      for (const r of rows) {
        const { token, hash } = this.credentials.newToken();
        const [row] = await tx
          .insert(device)
          .values({ name: r.name, profileId: r.profileId, customerId: r.customerId, groupId: r.groupId, tags: r.tags, location: r.location, serial: r.serial, credentialsHash: hash })
          .returning({ id: device.id });
        let claimCode: string | null = null;
        if (r.claim) {
          const code = newClaimCode();
          await tx.insert(deviceClaim).values({ deviceId: row!.id, codeHash: hashClaimCode(code) });
          claimCode = formatClaimCode(code);
        }
        if (r.location) locations.push([row!.id, r.location]);
        created.push({ id: row!.id, name: r.name, token, claimCode });
      }
    });
    const pairs = new Map(rows.map((r) => [`${r.profileId}/${r.customerId}`, r]));
    for (const r of pairs.values()) await ensureDeviceDashboard(this.db, r.profileId, r.customerId);
    if (locations.length) {
      const pipe = this.redis.pipeline();
      for (const [id, loc] of locations) pipe.set(locationKey(id), JSON.stringify(loc));
      await pipe.exec();
    }
    return { ok: true, rows: rows.length, errors: [], created };
  }

  private async plan(text: string): Promise<{ rows: Planned[]; errors: Issue[] }> {
    const table = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ''));
    if (!table.length) throw validation([{ path: ['file'], message: 'The file is empty' }]);
    if (table.length - 1 > IMPORT_MAX_ROWS) throw validation([{ path: ['file'], message: `At most ${IMPORT_MAX_ROWS} devices per file` }]);
    const header = table[0]!.map((h) => h.trim().toLowerCase());
    const errors: Issue[] = [];
    for (const h of header) {
      if (!(IMPORT_COLUMNS as readonly string[]).includes(h)) errors.push({ row: 0, field: h, message: `Unknown column; use ${IMPORT_COLUMNS.join(', ')}` });
    }
    for (const required of ['name', 'profile']) {
      if (!header.includes(required)) errors.push({ row: 0, field: required, message: 'Missing column' });
    }
    if (errors.length) return { rows: [], errors };

    const [profiles, customers, groups] = await Promise.all([
      this.db.select({ id: deviceProfile.id, name: deviceProfile.name, transport: deviceProfile.transport, locationMode: deviceProfile.locationMode }).from(deviceProfile),
      this.db.select({ id: customer.id, name: customer.name, slug: customer.slug }).from(customer),
      this.db.select({ id: customerGroup.id, name: customerGroup.name, customerId: customerGroup.customerId }).from(customerGroup),
    ]);
    const lookup = <T extends { id: string }>(items: T[], keys: (i: T) => string[], ref: string) => {
      const want = ref.toLowerCase();
      const hits = items.filter((i) => i.id === ref || keys(i).some((k) => k.toLowerCase() === want));
      return hits.length === 1 ? hits[0]! : hits.length ? 'ambiguous' : undefined;
    };

    const rows: Planned[] = [];
    table.slice(1).forEach((cells, i) => {
      const n = i + 1;
      const raw = Object.fromEntries(header.map((h, j) => [h, cells[j] ?? '']));
      const parsed = ImportRowSchema.safeParse(raw);
      if (!parsed.success) {
        const issue = parsed.error.issues[0]!;
        errors.push({ row: n, field: String(issue.path[0] ?? ''), message: issue.message });
        return;
      }
      const r = parsed.data;
      const fail = (field: string, message: string) => errors.push({ row: n, field, message });
      const profile = lookup(profiles, (p) => [p.name], r.profile);
      if (!profile || profile === 'ambiguous') return fail('profile', profile ? 'More than one profile has this name; use its id' : 'No such profile');
      if (profile.transport === 'aws-iot') return fail('profile', 'AWS IoT devices are created one at a time');
      let customerId: string | null = null;
      if (r.customer) {
        const c = lookup(customers, (x) => [x.slug, x.name], r.customer);
        if (!c || c === 'ambiguous') return fail('customer', c ? 'More than one customer has this name; use its slug' : 'No such customer');
        customerId = c.id;
      }
      let groupId: string | null = null;
      if (r.group) {
        if (!customerId) return fail('group', 'A group needs a customer');
        const g = lookup(groups.filter((x) => x.customerId === customerId), (x) => [x.name], r.group);
        if (!g || g === 'ambiguous') return fail('group', g ? 'More than one group has this name; use its id' : 'No such group for this customer');
        groupId = g.id;
      }
      if (r.claim && customerId) return fail('claim', 'Only unassigned devices can have a claim code');
      let location: DeviceLocationDto | null = null;
      if (r.lat !== undefined && r.lng !== undefined) {
        if (profile.locationMode === 'none') return fail('lat', "This device's profile doesn't use locations");
        location = { lat: r.lat, lng: r.lng, ts: Date.now(), source: 'fixed' };
      }
      rows.push({ name: r.name, profileId: profile.id, customerId, groupId, tags: r.tags, location, claim: r.claim, serial: r.serial ?? null, row: n });
    });

    // Serials are unique within a profile: in the file, and against existing devices.
    const withSerial = rows.filter((r) => r.serial);
    const seen = new Map<string, number>();
    for (const r of withSerial) {
      const k = `${r.profileId}/${r.serial}`;
      const first = seen.get(k);
      if (first !== undefined) errors.push({ row: r.row, field: 'serial', message: `Repeats the serial of row ${first}` });
      else seen.set(k, r.row);
    }
    if (withSerial.length) {
      const existing = await this.db
        .select({ profileId: device.profileId, serial: device.serial })
        .from(device)
        .where(inArray(device.serial, [...new Set(withSerial.map((r) => r.serial!))]));
      const taken = new Set(existing.map((e) => `${e.profileId}/${e.serial}`));
      for (const r of withSerial) {
        if (taken.has(`${r.profileId}/${r.serial}`)) errors.push({ row: r.row, field: 'serial', message: 'A device of this profile already has this serial' });
      }
    }
    return { rows, errors };
  }
}

/** Rows that failed (each counted once, header problems aside). */
function countBad(errors: Issue[]): number {
  return new Set(errors.filter((e) => e.row > 0).map((e) => e.row)).size;
}

async function readText(body: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += (chunk as Buffer).length;
    if (size > MAX_BYTES) throw new AppError(ErrorCode.TOO_LARGE, 'The file is larger than 2 MB', 413);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}
