import { describe, expect, it } from 'vitest';
import {
  AlarmRuleInputSchema,
  BUILT_IN_ROLES,
  NotificationPreferencesSchema,
  ReportScheduleInputSchema,
  WebhookInputSchema,
  isTimezone,
  notifyLevelAtLeast,
} from '../src/index.js';

const P = '11111111-1111-4111-8111-111111111111';
const base = { name: 'Low fuel', severity: 'major', scope: { kind: 'profile', profileId: P }, channels: ['inapp', 'email'] };

describe('alarm rules', () => {
  it('parses every available rule type with defaults', () => {
    const rules = [
      { type: 'threshold', condition: { key: 'fuel_level', op: '<', value: 20 }, clear: { margin: 2 } },
      { type: 'range', condition: { key: 'mains_v', min: 200, max: 250, mode: 'outside' }, clear: { margin: 5 } },
      { type: 'duration', condition: { key: 'temp', op: '>', value: 40, forS: 300 }, clear: { margin: 1 } },
      { type: 'rate_of_change', condition: { key: 'fuel_level', perMinute: 5, direction: 'down' }, clear: { margin: 1 } },
      { type: 'state_match', condition: { key: 'door_open', values: [true] } },
      { type: 'status', condition: { statuses: ['offline', 'dead'] } },
      { type: 'no_data_key', condition: { key: 'fuel_level', forS: 3600 } },
    ];
    for (const r of rules) {
      const parsed = AlarmRuleInputSchema.parse({ ...base, ...r });
      expect(parsed).toMatchObject({ type: r.type, enabled: true, cooldownS: 300, schedule: null });
    }
  });

  it('rejects reserved types, bad keys, negative margins and inverted ranges', () => {
    const bad = [
      { type: 'geofence', condition: {} },
      { type: 'geofence', condition: { geofenceId: 'not-a-uuid' } },
      { type: 'geofence', condition: { geofenceId: P }, clear: { marginM: -5 } },
      { type: 'maintenance_due', condition: {} },
      { type: 'threshold', condition: { key: 'bad key', op: '<', value: 1 }, clear: { margin: 0 } },
      { type: 'threshold', condition: { key: 'k', op: '<', value: 1 }, clear: { margin: -1 } },
      { type: 'range', condition: { key: 'k', min: 10, max: 5, mode: 'outside' }, clear: { margin: 0 } },
    ];
    for (const r of bad) expect(AlarmRuleInputSchema.safeParse({ ...base, ...r }).success).toBe(false);
    const reserved = AlarmRuleInputSchema.safeParse({ ...base, type: 'maintenance_due', condition: {} });
    expect(JSON.stringify(reserved.error?.issues)).toContain('not available yet');
  });

  it('accepts geofence rules, leaving by default, with a 20 m clear margin', () => {
    const parsed = AlarmRuleInputSchema.parse({ ...base, type: 'geofence', condition: { geofenceId: P } });
    expect(parsed).toMatchObject({ type: 'geofence', condition: { geofenceId: P, trigger: 'outside' }, clear: { marginM: 20 } });
  });

  it('validates scopes, schedules and recipients', () => {
    const t = { type: 'status', condition: { statuses: ['offline'] } };
    expect(AlarmRuleInputSchema.safeParse({ ...base, ...t, scope: { kind: 'device', deviceId: P } }).success).toBe(true);
    expect(AlarmRuleInputSchema.safeParse({ ...base, ...t, scope: { kind: 'customer', customerId: P, profileId: P } }).success).toBe(true);
    expect(AlarmRuleInputSchema.safeParse({ ...base, ...t, scope: { kind: 'device' } }).success).toBe(false);
    const sched = { days: [1, 2, 3, 4, 5], from: '22:00', to: '06:00', timezone: 'Europe/London' };
    expect(AlarmRuleInputSchema.parse({ ...base, ...t, schedule: sched }).schedule).toEqual(sched);
    expect(AlarmRuleInputSchema.safeParse({ ...base, ...t, schedule: { ...sched, timezone: 'Mars/Base' } }).success).toBe(false);
    expect(AlarmRuleInputSchema.safeParse({ ...base, ...t, schedule: { ...sched, from: '25:00' } }).success).toBe(false);
    expect(AlarmRuleInputSchema.parse({ ...base, ...t }).recipients).toEqual({ roles: [], userIds: [], groupIds: [] });
  });
});

describe('preferences, webhooks and schedules', () => {
  it('orders notification levels', () => {
    expect(notifyLevelAtLeast('critical', 'major')).toBe(true);
    expect(notifyLevelAtLeast('warning', 'major')).toBe(false);
    expect(notifyLevelAtLeast('info', 'info')).toBe(true);
  });

  it('defaults preferences', () => {
    expect(NotificationPreferencesSchema.parse({})).toEqual({
      email: true,
      push: true,
      minSeverity: 'info',
      quietHours: null,
      criticalBypassesQuietHours: true,
      digest: { threshold: 10, windowMin: 15 },
    });
  });

  it('accepts only http(s) webhook URLs and known events', () => {
    expect(WebhookInputSchema.safeParse({ name: 'n', url: 'https://hooks.example.com/x', events: ['alarm.raised'] }).success).toBe(true);
    expect(WebhookInputSchema.safeParse({ name: 'n', url: 'ftp://x', events: ['alarm.raised'] }).success).toBe(false);
    expect(WebhookInputSchema.safeParse({ name: 'n', url: 'https://x.example', events: ['telemetry.everything'] }).success).toBe(false);
  });

  it('parses report schedules', () => {
    const s = ReportScheduleInputSchema.parse({
      name: 'Daily site report',
      target: { kind: 'dashboard', deviceId: P },
      timewindow: { kind: 'relative', lastMs: 86_400_000 },
      cadence: { kind: 'daily', time: '07:30' },
      timezone: 'Asia/Karachi',
      recipients: [P],
    });
    expect(s).toMatchObject({ enabled: true, cadence: { kind: 'daily', time: '07:30' } });
    expect(ReportScheduleInputSchema.safeParse({ ...s, cadence: { kind: 'monthly', day: 31, time: '07:30' } }).success).toBe(false);
  });

  it('validates IANA timezones', () => {
    expect(isTimezone('UTC')).toBe(true);
    expect(isTimezone('America/New_York')).toBe(true);
    expect(isTimezone('Nowhere/City')).toBe(false);
  });
});

describe('alarm permissions', () => {
  it('grants alarm permissions by role', () => {
    const has = (role: keyof typeof BUILT_IN_ROLES, p: string) => (BUILT_IN_ROLES[role].permissions as string[]).includes(p);
    expect(has('customer_viewer', 'alarm.read')).toBe(true);
    expect(has('customer_viewer', 'alarm.ack')).toBe(false);
    expect(has('customer_operator', 'alarm.ack')).toBe(true);
    expect(has('customer_admin', 'alarm.rule.write')).toBe(true);
    expect(has('customer_admin', 'webhook.manage')).toBe(true);
    expect(has('customer_operator', 'report.schedule')).toBe(true);
    expect(has('support', 'alarm.read')).toBe(true);
    expect(has('platform_admin', 'alarm.rule.write')).toBe(true);
  });
});
