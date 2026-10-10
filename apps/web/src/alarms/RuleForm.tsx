import { ALARM_RULE_TYPES,
  ALARM_SEVERITIES,
  type AlarmRuleDto,
  type AlarmRuleInput,
  AlarmRuleInputSchema,
  type AlarmRuleType,
  type AlarmScope,
  type BuiltInRoleKey,
  type DeviceProfileDto,
  type GeofenceDto,
  profileKeys,
} from '@perspice/shared';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorText } from '@/components/ErrorText';
import { selectClass } from '@/components/TimezoneSelect';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { describeRule } from './describe';

export const TYPE_LABEL: Record<AlarmRuleType, string> = {
  threshold: 'Value above/below a threshold',
  range: 'Value outside (or inside) a range',
  duration: 'Value past a threshold for a while',
  rate_of_change: 'Value changing too fast',
  state_match: 'Value equals a state',
  status: 'Device offline or dead',
  no_data_key: 'Value stops reporting',
  geofence: 'Device leaves (or enters) a geofence',
};

const DEFAULT_CONDITION: Record<AlarmRuleType, { condition: Record<string, unknown>; clear: Record<string, unknown> }> = {
  threshold: { condition: { key: '', op: '<', value: 0 }, clear: { margin: 0 } },
  range: { condition: { key: '', min: 0, max: 100, mode: 'outside' }, clear: { margin: 0 } },
  duration: { condition: { key: '', op: '>', value: 0, forS: 300 }, clear: { margin: 0 } },
  rate_of_change: { condition: { key: '', perMinute: 1, direction: 'either' }, clear: { margin: 0 } },
  state_match: { condition: { key: '', values: [true] }, clear: {} },
  status: { condition: { statuses: ['offline', 'dead'] }, clear: {} },
  no_data_key: { condition: { key: '', forS: 3600 }, clear: {} },
  geofence: { condition: { geofenceId: '', trigger: 'outside' }, clear: { marginM: 20 } },
};

const CUSTOMER_ROLES: BuiltInRoleKey[] = ['customer_admin', 'customer_operator', 'customer_viewer'];
const PLATFORM_ROLES: BuiltInRoleKey[] = ['platform_admin', 'support'];
const ROLE_LABEL: Record<string, string> = {
  customer_admin: 'Customer admins',
  customer_operator: 'Customer operators',
  customer_viewer: 'Customer viewers',
  platform_admin: 'Platform admins',
  support: 'Support',
};

/** Parses "true, open, 3" into [true, "open", 3]. */
const parseValues = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => (x === 'true' ? true : x === 'false' ? false : x !== '' && !Number.isNaN(Number(x)) ? Number(x) : x));

type Draft = Omit<AlarmRuleInput, 'condition' | 'clear'> & { condition: Record<string, unknown>; clear: Record<string, unknown> };

/**
 * Create or edit an alarm rule. The scope is fixed by the caller (a profile, device or customer);
 * fields follow the rule type and the condition is previewed in words.
 */
export function RuleForm({
  scope,
  rule,
  profile,
  onSaved,
}: {
  scope: AlarmScope;
  rule?: AlarmRuleDto;
  profile?: DeviceProfileDto | null;
  onSaved: (r: AlarmRuleDto) => void;
}) {
  const { user } = useAuth();
  const platform = user?.scopeType === 'platform';
  const [error, setError] = useState<unknown>(null);
  const [d, setD] = useState<Draft>(() =>
    rule
      ? { ...rule, scope }
      : {
          name: '',
          severity: 'major',
          scope,
          type: 'threshold',
          ...DEFAULT_CONDITION.threshold,
          enabled: true,
          schedule: null,
          cooldownS: 300,
          recipients: { roles: ['customer_admin'], userIds: [], groupIds: [] },
          channels: ['inapp', 'email'],
        },
  );
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch });
  const setCond = (patch: Record<string, unknown>) => setD({ ...d, condition: { ...d.condition, ...patch } });
  const keys = profileKeys(profile);
  const label = (k: string) => keys.find((x) => x.key === k)?.label ?? k;
  const parsed = AlarmRuleInputSchema.safeParse(d);
  const roles = platform ? [...CUSTOMER_ROLES, ...PLATFORM_ROLES] : CUSTOMER_ROLES;
  const c = d.condition;
  const num = (v: string) => (v === '' ? 0 : Number(v));
  const geofences = useQuery({ queryKey: ['geofences'], queryFn: () => api<GeofenceDto[]>('/geofences'), enabled: d.type === 'geofence' });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const saved = rule
        ? await api<AlarmRuleDto>(`/alarm-rules/${rule.id}`, { method: 'PUT', body: d })
        : await api<AlarmRuleDto>('/alarm-rules', { body: d });
      onSaved(saved);
    } catch (err) {
      setError(err);
    }
  }

  const keyField = (
    <Field label="Value">
      {(id) =>
        keys.length ? (
          <select id={id} required className={selectClass} value={String(c.key ?? '')} onChange={(e) => setCond({ key: e.target.value })}>
            <option value="">Choose…</option>
            {keys.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </select>
        ) : (
          <Input id={id} required placeholder="telemetry key, e.g. fuel_level" value={String(c.key ?? '')} onChange={(e) => setCond({ key: e.target.value })} />
        )
      }
    </Field>
  );
  const opField = (
    <Field label="Is">
      {(id) => (
        <select id={id} className={selectClass} value={String(c.op)} onChange={(e) => setCond({ op: e.target.value })}>
          <option value=">">above</option>
          <option value=">=">at or above</option>
          <option value="<">below</option>
          <option value="<=">at or below</option>
        </select>
      )}
    </Field>
  );
  const marginField = (
    <Field label="Clear margin" help="How far back the value must go before the alarm clears (stops flapping).">
      {(id) => <Input id={id} type="number" min={0} step="any" value={String(d.clear.margin ?? 0)} onChange={(e) => set({ clear: { margin: num(e.target.value) } })} />}
    </Field>
  );

  return (
    <form className="space-y-4" onSubmit={(e) => void submit(e)}>
      <Field label="Name">{(id) => <Input id={id} required maxLength={120} value={d.name} onChange={(e) => set({ name: e.target.value })} />}</Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          {(id) => (
            <select id={id} className={selectClass} value={d.type} onChange={(e) => setD({ ...d, type: e.target.value as AlarmRuleType, ...DEFAULT_CONDITION[e.target.value as AlarmRuleType] } as Draft)}>
              {ALARM_RULE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Severity">
          {(id) => (
            <select id={id} className={selectClass} value={d.severity} onChange={(e) => set({ severity: e.target.value as Draft['severity'] })}>
              {ALARM_SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s[0]!.toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {d.type !== 'status' && d.type !== 'geofence' && keyField}
        {(d.type === 'threshold' || d.type === 'duration') && (
          <>
            {opField}
            <Field label="Threshold">{(id) => <Input id={id} type="number" step="any" value={String(c.value)} onChange={(e) => setCond({ value: num(e.target.value) })} />}</Field>
          </>
        )}
        {d.type === 'duration' && <Field label="For (seconds)">{(id) => <Input id={id} type="number" min={1} value={String(c.forS)} onChange={(e) => setCond({ forS: num(e.target.value) })} />}</Field>}
        {d.type === 'range' && (
          <>
            <Field label="Alarm when the value is">
              {(id) => (
                <select id={id} className={selectClass} value={String(c.mode)} onChange={(e) => setCond({ mode: e.target.value })}>
                  <option value="outside">outside the range</option>
                  <option value="inside">inside the range</option>
                </select>
              )}
            </Field>
            <Field label="Minimum">{(id) => <Input id={id} type="number" step="any" value={String(c.min)} onChange={(e) => setCond({ min: num(e.target.value) })} />}</Field>
            <Field label="Maximum">{(id) => <Input id={id} type="number" step="any" value={String(c.max)} onChange={(e) => setCond({ max: num(e.target.value) })} />}</Field>
          </>
        )}
        {d.type === 'rate_of_change' && (
          <>
            <Field label="Direction">
              {(id) => (
                <select id={id} className={selectClass} value={String(c.direction)} onChange={(e) => setCond({ direction: e.target.value })}>
                  <option value="either">rising or falling</option>
                  <option value="up">rising</option>
                  <option value="down">falling</option>
                </select>
              )}
            </Field>
            <Field label="Faster than (per minute)">{(id) => <Input id={id} type="number" min={0} step="any" value={String(c.perMinute)} onChange={(e) => setCond({ perMinute: num(e.target.value) })} />}</Field>
          </>
        )}
        {d.type === 'state_match' && (
          <Field label="Equals any of" help="Comma-separated, e.g. true or open, fault">
            {(id) => <Input id={id} value={(c.values as unknown[]).map(String).join(', ')} onChange={(e) => setCond({ values: parseValues(e.target.value) })} />}
          </Field>
        )}
        {d.type === 'no_data_key' && <Field label="For (seconds)">{(id) => <Input id={id} type="number" min={60} value={String(c.forS)} onChange={(e) => setCond({ forS: num(e.target.value) })} />}</Field>}
        {d.type === 'geofence' && (
          <>
            <Field label="Geofence" help={geofences.data?.length === 0 ? 'Create a geofence first (Geofences in the menu).' : undefined}>
              {(id) => (
                <select id={id} className={selectClass} value={String(c.geofenceId)} onChange={(e) => setCond({ geofenceId: e.target.value })}>
                  <option value="">Choose…</option>
                  {(geofences.data ?? []).map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                      {g.customerId === null ? ' (platform-wide)' : ''}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Alarm when the device">
              {(id) => (
                <select id={id} className={selectClass} value={String(c.trigger)} onChange={(e) => setCond({ trigger: e.target.value })}>
                  <option value="outside">leaves the geofence</option>
                  <option value="inside">enters the geofence</option>
                </select>
              )}
            </Field>
            <Field label="Clear margin (m)" help="How far back the device must be before the alarm clears (GPS jitter at the edge).">
              {(id) => <Input id={id} type="number" min={0} value={String(d.clear.marginM ?? 20)} onChange={(e) => set({ clear: { marginM: num(e.target.value) } })} />}
            </Field>
          </>
        )}
        {d.type === 'status' && (
          <fieldset className="col-span-2 flex gap-4 text-sm">
            <legend className="mb-1 text-sm font-medium">Alarm when the device is</legend>
            {(['offline', 'dead'] as const).map((s) => (
              <label key={s} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={(c.statuses as string[]).includes(s)}
                  onChange={(e) => setCond({ statuses: e.target.checked ? [...(c.statuses as string[]), s] : (c.statuses as string[]).filter((x) => x !== s) })}
                />
                {s}
              </label>
            ))}
          </fieldset>
        )}
        {(d.type === 'threshold' || d.type === 'range' || d.type === 'duration' || d.type === 'rate_of_change') && marginField}
      </div>

      <p role="status" aria-label="Rule preview" className="rounded-md bg-slate-100 px-3 py-2 text-sm dark:bg-slate-800">
        {parsed.success ? `Raises when: ${describeRule(parsed.data, label)}` : 'Fill in the condition to see it in words.'}
      </p>

      <fieldset className="space-y-1 text-sm">
        <legend className="text-sm font-medium">Notify</legend>
        <div className="flex flex-wrap gap-4">
          {roles.map((r) => (
            <label key={r} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={d.recipients.roles.includes(r)}
                onChange={(e) => set({ recipients: { ...d.recipients, roles: e.target.checked ? [...d.recipients.roles, r] : d.recipients.roles.filter((x) => x !== r) } })}
              />
              {ROLE_LABEL[r]}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap gap-4 pt-1">
          {(['inapp', 'email', 'push'] as const).map((ch) => (
            <label key={ch} className="flex items-center gap-1.5">
              <input type="checkbox" checked={d.channels.includes(ch)} onChange={(e) => set({ channels: e.target.checked ? [...d.channels, ch] : d.channels.filter((x) => x !== ch) })} />
              {ch === 'inapp' ? 'In-app' : ch === 'email' ? 'Email' : 'Push'}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Repeat notifications at most every (minutes)">
          {(id) => <Input id={id} type="number" min={0} max={1440} value={Math.round(d.cooldownS / 60)} onChange={(e) => set({ cooldownS: num(e.target.value) * 60 })} />}
        </Field>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" checked={d.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Enabled
        </label>
      </div>
      <ErrorText error={error} />
      <Button type="submit" disabled={!parsed.success}>
        {rule ? 'Save rule' : 'Create rule'}
      </Button>
    </form>
  );
}
