import { Inject, Injectable } from '@nestjs/common';
import { type AlarmRuleDto, type AlarmRuleInput, AlarmRuleInputSchema } from '@perspice/shared';
import { type SQL, and, eq, inArray, or, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import type { AuthUser } from '../auth/auth.types';
import { forbidden, notFound, validation } from '../common/app-error';
import { REDIS } from '../common/redis.module';
import { DB } from '../db/db.module';
import { isUuid, scoped } from '../db/scoped-repo';
import { alarm, alarmEvent, alarmRule, customer, customerGroup, device, deviceProfile, user } from '../db/schema';
import { DevicesService } from '../devices/devices.service';
import { ProfilesService } from '../devices/profiles.service';
import { type Scope, ScopeService } from '../rbac/scope';
import { type RuleRow, appliesTo, effectiveRules, toRuleDto } from './effective';

/** Bumped on every rule write; the rules engine reloads its cache when it changes. */
export const RULES_VERSION_KEY = 'alarm-rules:version';

export interface RuleFilter {
  profileId?: string;
  deviceId?: string;
  customerId?: string;
}

/**
 * Alarm rule CRUD. Platform users manage every scope; customer admins manage customer-level
 * rules for their own customer and device rules for their own devices, and see the profile rules
 * their devices inherit (read-only). Recipients must belong to the rule's tenant (Review Focus 2).
 */
@Injectable()
export class AlarmRulesService {
  constructor(
    @Inject(DB) private readonly db: DB,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly scopes: ScopeService,
    private readonly devices: DevicesService,
    private readonly profiles: ProfilesService,
  ) {}

  async list(actor: AuthUser, f: RuleFilter): Promise<AlarmRuleDto[]> {
    const conds: (SQL | undefined)[] = [
      await this.visible(actor),
      f.profileId ? eq(alarmRule.profileId, f.profileId) : undefined,
      f.deviceId ? eq(alarmRule.deviceId, f.deviceId) : undefined,
      f.customerId ? eq(alarmRule.customerId, f.customerId) : undefined,
    ];
    const rows = await this.db.select().from(alarmRule).where(and(...conds)).orderBy(alarmRule.name).limit(1000);
    return rows.map((r) => this.dto(actor, r));
  }

  async get(actor: AuthUser, id: string): Promise<AlarmRuleDto> {
    return this.dto(actor, await this.find(actor, id));
  }

  async create(actor: AuthUser, body: unknown): Promise<AlarmRuleDto> {
    const input = AlarmRuleInputSchema.parse(body);
    await this.authorize(actor, input);
    const [row] = await this.db
      .insert(alarmRule)
      .values({ ...this.columns(input), createdBy: actor.id })
      .returning();
    await this.bump();
    return this.dto(actor, row!);
  }

  async update(actor: AuthUser, id: string, body: unknown): Promise<AlarmRuleDto> {
    const current = await this.find(actor, id);
    this.assertWritable(actor, current);
    const input = AlarmRuleInputSchema.parse(body);
    await this.authorize(actor, input, id);
    const [row] = await this.db
      .update(alarmRule)
      .set({ ...this.columns(input), version: sql`${alarmRule.version} + 1`, updatedAt: new Date() })
      .where(eq(alarmRule.id, id))
      .returning();
    await this.bump();
    return this.dto(actor, row!);
  }

  /** Deleting a rule clears its open alarms (reason `rule_removed`). */
  async remove(actor: AuthUser, id: string): Promise<void> {
    const current = await this.find(actor, id);
    this.assertWritable(actor, current);
    await this.db.transaction(async (tx) => {
      const now = new Date();
      const cleared = await tx
        .update(alarm)
        .set({ status: 'cleared', clearedAt: now, clearReason: 'rule_removed', updatedAt: now })
        .where(and(eq(alarm.ruleId, id), sql`${alarm.status} <> 'cleared'`))
        .returning({ id: alarm.id });
      if (cleared.length) {
        await tx.insert(alarmEvent).values(cleared.map((a) => ({ alarmId: a.id, type: 'cleared' as const, userId: actor.id, data: { reason: 'rule_removed' }, ts: now })));
      }
      await tx.delete(alarmRule).where(eq(alarmRule.id, id));
    });
    await this.bump();
  }

  /** The rules that run for a device (what the engine evaluates). */
  async effective(actor: AuthUser, deviceId: string): Promise<AlarmRuleDto[]> {
    const d = await this.devices.find(actor, deviceId);
    return effectiveRules(await this.candidates(d), d).map((r) => this.dto(actor, r));
  }

  /** Every rule row that could apply to the device (unfiltered). */
  candidates(d: { id: string; profileId: string; customerId: string | null }): Promise<RuleRow[]> {
    return this.db
      .select()
      .from(alarmRule)
      .where(
        or(
          and(eq(alarmRule.scopeKind, 'profile'), eq(alarmRule.profileId, d.profileId)),
          and(eq(alarmRule.scopeKind, 'device'), eq(alarmRule.deviceId, d.id)),
          d.customerId ? and(eq(alarmRule.scopeKind, 'customer'), eq(alarmRule.customerId, d.customerId)) : undefined,
        ),
      );
  }

  // ── Scope and tenant checks ────────────────────────────────────────────────────────────────

  private dto(actor: AuthUser, r: RuleRow): AlarmRuleDto {
    return toRuleDto(r, { hidePlatformUsers: actor.scopeType === 'customer' });
  }

  private async find(actor: AuthUser, id: string): Promise<RuleRow> {
    if (!isUuid(id)) throw notFound();
    const [row] = await this.db
      .select()
      .from(alarmRule)
      .where(and(eq(alarmRule.id, id), await this.visible(actor)))
      .limit(1);
    if (!row) throw notFound();
    return row;
  }

  /** Customers see their own rules, rules on their devices, and profile rules their devices inherit. */
  private async visible(actor: AuthUser): Promise<SQL | undefined> {
    const scope = await this.scopes.forUser(actor);
    if (scope.kind === 'platform') return undefined;
    const devices = this.db.select({ id: device.id }).from(device).where(scoped(device, scope));
    const profiles = this.db.selectDistinct({ id: device.profileId }).from(device).where(scoped(device, scope));
    return or(
      and(eq(alarmRule.scopeKind, 'customer'), eq(alarmRule.customerId, scope.customerId)),
      and(eq(alarmRule.scopeKind, 'device'), inArray(alarmRule.deviceId, devices)),
      and(eq(alarmRule.scopeKind, 'profile'), inArray(alarmRule.profileId, profiles)),
    );
  }

  private assertWritable(actor: AuthUser, r: RuleRow): void {
    if (actor.scopeType === 'customer' && r.scopeKind === 'profile') throw forbidden('Profile rules are managed by the platform');
    if (actor.scopeType === 'customer' && r.scopeKind === 'customer' && actor.groupId) {
      throw forbidden('Users limited to a group can only manage device rules');
    }
  }

  /** Checks the scope, opt-out target and recipients; `selfId` excludes the rule being edited. */
  private async authorize(actor: AuthUser, input: AlarmRuleInput, selfId?: string): Promise<void> {
    const scope = await this.scopes.forUser(actor);
    const tenant = await this.tenantOf(actor, scope, input);
    await this.checkRecipients(actor, input, tenant);
    if (input.disablesRuleId) await this.checkOptOut(actor, input, selfId);
  }

  /** The customer whose users may receive this rule's notifications (null = platform users). */
  private async tenantOf(actor: AuthUser, scope: Scope, input: AlarmRuleInput): Promise<string | null> {
    const s = input.scope;
    if (s.kind === 'profile') {
      if (scope.kind !== 'platform') throw forbidden('Profile rules are managed by the platform');
      const p = await this.db.query.deviceProfile.findFirst({ where: eq(deviceProfile.id, s.profileId) });
      if (!p) throw notFound();
      return null;
    }
    if (s.kind === 'device') return (await this.devices.find(actor, s.deviceId)).customerId;
    if (scope.kind === 'customer') {
      if (s.customerId !== scope.customerId) throw notFound();
      if (actor.groupId) throw forbidden('Users limited to a group can only manage device rules');
    } else if (!(await this.db.query.customer.findFirst({ where: eq(customer.id, s.customerId) }))) {
      throw notFound();
    }
    if (s.profileId) await this.profiles.get(actor, s.profileId); // 404 when not visible
    return s.customerId;
  }

  private async checkRecipients(actor: AuthUser, input: AlarmRuleInput, tenant: string | null): Promise<void> {
    const { userIds, groupIds, roles } = input.recipients;
    if (actor.scopeType === 'customer' && roles.some((r) => !r.startsWith('customer_'))) {
      throw validation([{ path: ['recipients', 'roles'], message: 'Only customer roles can be notified' }]);
    }
    if (userIds.length) {
      const found = await this.db.select({ id: user.id, scopeType: user.scopeType, customerId: user.customerId }).from(user).where(inArray(user.id, userIds));
      const ok = (u: (typeof found)[number]) => (tenant === null ? u.scopeType === 'platform' : u.customerId === tenant);
      if (found.length !== new Set(userIds).size || !found.every(ok)) {
        throw validation([{ path: ['recipients', 'userIds'], message: tenant === null ? 'Profile rules can notify platform users only' : 'Recipients must belong to the device’s customer' }]);
      }
    }
    if (groupIds.length) {
      const found = tenant === null ? [] : await this.db.select({ id: customerGroup.id }).from(customerGroup).where(and(inArray(customerGroup.id, groupIds), eq(customerGroup.customerId, tenant)));
      if (found.length !== new Set(groupIds).size) {
        throw validation([{ path: ['recipients', 'groupIds'], message: 'Groups must belong to the device’s customer' }]);
      }
    }
  }

  /** An opt-out must point at a rule that is inherited by the opt-out's scope. */
  private async checkOptOut(actor: AuthUser, input: AlarmRuleInput, selfId?: string): Promise<void> {
    const targetId = input.disablesRuleId!;
    const bad = () => validation([{ path: ['disablesRuleId'], message: 'Choose a rule this scope inherits' }]);
    if (targetId === selfId || !isUuid(targetId)) throw bad();
    const target = await this.find(actor, targetId).catch(() => {
      throw bad();
    });
    if (target.disablesRuleId) throw bad();
    const s = input.scope;
    if (s.kind === 'device') {
      const d = await this.devices.find(actor, s.deviceId);
      if (target.scopeKind === 'device' || !appliesTo(target, d)) throw bad();
    } else if (s.kind === 'customer') {
      if (target.scopeKind !== 'profile' || (s.profileId && s.profileId !== target.profileId)) throw bad();
    } else {
      throw bad();
    }
  }

  private columns(input: AlarmRuleInput) {
    const s = input.scope;
    return {
      name: input.name,
      scopeKind: s.kind,
      profileId: s.kind === 'profile' ? s.profileId : s.kind === 'customer' ? (s.profileId ?? null) : null,
      deviceId: s.kind === 'device' ? s.deviceId : null,
      customerId: s.kind === 'customer' ? s.customerId : null,
      disablesRuleId: input.disablesRuleId ?? null,
      type: input.type,
      condition: input.condition as Record<string, unknown>,
      clear: input.clear as Record<string, unknown>,
      severity: input.severity,
      schedule: input.schedule,
      cooldownS: input.cooldownS,
      recipients: input.recipients,
      channels: input.channels,
      enabled: input.enabled,
    };
  }

  private async bump(): Promise<void> {
    await this.redis.incr(RULES_VERSION_KEY);
  }
}
