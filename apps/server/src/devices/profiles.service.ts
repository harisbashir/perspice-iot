import { CONFIG, type Config } from '../config/config';
import { Inject, Injectable } from '@nestjs/common';
import { type DeviceProfileDto, LocationKeysSchema, TripSettingsSchema } from '@perspice/shared';
import { asc, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { conflict, notFound, validation } from '../common/app-error';
import { DB } from '../db/db.module';
import { isUuid, scoped } from '../db/scoped-repo';
import { device, deviceProfile } from '../db/schema';
import { type Scope, ScopeService } from '../rbac/scope';
import type { CreateProfile, UpdateProfile } from './profile.schema';
import { timeoutIssue } from './profile.schema';

type ProfileRow = typeof deviceProfile.$inferSelect;

export const toProfileDto = (p: ProfileRow): DeviceProfileDto => ({
  id: p.id,
  name: p.name,
  description: p.description,
  telemetrySchema: p.telemetrySchema,
  commands: p.commands,
  offlineTimeoutS: p.offlineTimeoutS,
  deadTimeoutS: p.deadTimeoutS,
  sleepy: p.sleepy,
  transport: p.transport,
  retentionDays: p.retentionDays,
  statusNotify: p.statusNotify,
  locationMode: p.locationMode,
  locationKeys: LocationKeysSchema.parse(p.locationKeys),
  trips: TripSettingsSchema.parse(p.tripSettings),
  defaultDashboardTemplateId: p.defaultDashboardTemplateId,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

/** Profiles are platform-owned; customers see only the profiles their devices use. */
@Injectable()
export class ProfilesService {
  constructor(
    @Inject(DB) private readonly db: DB,
    private readonly scopes: ScopeService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  /** aws-iot profiles need the platform on AWS IoT Core; certificates can't follow a transport switch. */
  private async checkTransport(transport: string | undefined, existing?: ProfileRow): Promise<void> {
    if (!transport || transport === existing?.transport) return;
    if (transport === 'aws-iot' && this.config.MQTT_TRANSPORT !== 'aws-iot') {
      throw validation([{ path: ['transport'], message: 'AWS IoT Core is not configured on this server (MQTT_TRANSPORT=aws-iot)' }]);
    }
    if (existing && (transport === 'aws-iot' || existing.transport === 'aws-iot')) {
      const used = await this.db.query.device.findFirst({ where: eq(device.profileId, existing.id), columns: { id: true } });
      if (used) throw conflict('Devices of this profile have credentials for their current transport; create a new profile instead');
    }
  }

  async list(actor: AuthUser): Promise<DeviceProfileDto[]> {
    const scope = await this.scopes.forUser(actor);
    const visible = scope.kind === 'platform' ? undefined : inArray(deviceProfile.id, this.usedProfileIds(scope));
    const rows = await this.db.select().from(deviceProfile).where(visible).orderBy(asc(deviceProfile.name));
    return rows.map(toProfileDto);
  }

  async get(actor: AuthUser, id: string): Promise<ProfileRow> {
    if (!isUuid(id)) throw notFound();
    const scope = await this.scopes.forUser(actor);
    const [row] = await this.db
      .select()
      .from(deviceProfile)
      .where(
        scope.kind === 'platform'
          ? eq(deviceProfile.id, id)
          : inArray(deviceProfile.id, this.usedProfileIds(scope, id)),
      )
      .limit(1);
    if (!row) throw notFound();
    return row;
  }

  async create(input: z.infer<typeof CreateProfile>): Promise<DeviceProfileDto> {
    const offline = input.offlineTimeoutS ?? 300;
    const dead = input.deadTimeoutS ?? 86400;
    if (dead <= offline) throw validation([timeoutIssue]);
    await this.checkTransport(input.transport);
    const { trips, ...fields } = input;
    const [row] = await this.db.insert(deviceProfile).values({ ...fields, ...(trips ? { tripSettings: trips } : {}) }).returning();
    return toProfileDto(row!);
  }

  async update(actor: AuthUser, id: string, patch: z.infer<typeof UpdateProfile>): Promise<DeviceProfileDto> {
    const existing = await this.get(actor, id);
    if ((patch.deadTimeoutS ?? existing.deadTimeoutS) <= (patch.offlineTimeoutS ?? existing.offlineTimeoutS)) {
      throw validation([timeoutIssue]);
    }
    await this.checkTransport(patch.transport, existing);
    const { trips, ...fields } = patch;
    const [row] = await this.db
      .update(deviceProfile)
      .set({ ...fields, ...(trips ? { tripSettings: trips } : {}) })
      .where(eq(deviceProfile.id, id))
      .returning();
    return toProfileDto(row!);
  }

  async remove(actor: AuthUser, id: string): Promise<void> {
    await this.get(actor, id);
    const used = await this.db.query.device.findFirst({ where: eq(device.profileId, id), columns: { id: true } });
    if (used) throw conflict('Profile is used by devices');
    await this.db.delete(deviceProfile).where(eq(deviceProfile.id, id));
  }

  private usedProfileIds(scope: Scope, onlyId?: string) {
    return this.db
      .selectDistinct({ id: device.profileId })
      .from(device)
      .where(scoped(device, scope, onlyId ? eq(device.profileId, onlyId) : undefined));
  }
}
