import type { AlarmRuleDto } from '@perspice/shared';
import type { alarmRule } from '../db/schema';

export type RuleRow = typeof alarmRule.$inferSelect;

export interface RuleTarget {
  id: string;
  profileId: string;
  customerId: string | null;
}

/** Whether a rule row is scoped to this device at all (before enable/opt-out filtering). */
export function appliesTo(r: RuleRow, d: RuleTarget): boolean {
  switch (r.scopeKind) {
    case 'profile':
      return r.profileId === d.profileId;
    case 'device':
      return r.deviceId === d.id;
    case 'customer':
      return !!d.customerId && r.customerId === d.customerId && (!r.profileId || r.profileId === d.profileId);
  }
}

/**
 * The rules that run for a device: enabled profile, device and customer rules that apply to it,
 * minus those switched off by an enabled opt-out row (device or customer scope).
 */
export function effectiveRules(rows: RuleRow[], d: RuleTarget): RuleRow[] {
  const applicable = rows.filter((r) => appliesTo(r, d));
  const disabled = new Set(applicable.filter((r) => r.disablesRuleId && r.enabled).map((r) => r.disablesRuleId));
  return applicable.filter((r) => !r.disablesRuleId && r.enabled && !disabled.has(r.id));
}

export function toRuleDto(r: RuleRow, opts: { hidePlatformUsers?: boolean } = {}): AlarmRuleDto {
  const scope =
    r.scopeKind === 'profile'
      ? { kind: 'profile' as const, profileId: r.profileId! }
      : r.scopeKind === 'device'
        ? { kind: 'device' as const, deviceId: r.deviceId! }
        : { kind: 'customer' as const, customerId: r.customerId!, profileId: r.profileId };
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    severity: r.severity,
    scope,
    enabled: r.enabled,
    schedule: r.schedule ?? null,
    cooldownS: r.cooldownS,
    // Profile rules may list platform users; customers see only the roles.
    recipients: opts.hidePlatformUsers && r.scopeKind === 'profile' ? { ...r.recipients, userIds: [] } : r.recipients,
    channels: r.channels,
    disablesRuleId: r.disablesRuleId,
    condition: r.condition,
    clear: r.clear,
    version: r.version,
    origin: r.scopeKind,
    createdAt: r.createdAt.getTime(),
    updatedAt: r.updatedAt.getTime(),
  } as AlarmRuleDto;
}
