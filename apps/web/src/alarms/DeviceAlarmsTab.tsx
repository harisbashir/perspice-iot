import type { AlarmRuleDto, DeviceProfileDto } from '@perspice/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { AlarmsTable } from './AlarmsTable';
import { SeverityBadge } from './badges';
import { describeRule } from './describe';

/** A device's alarms and the rules that run for it. */
export function DeviceAlarmsTab({ deviceId, profile }: { deviceId: string; profile: DeviceProfileDto | null }) {
  const { hasPerm } = useAuth();
  const { data: rules = [] } = useQuery({
    queryKey: ['alarm-rules', 'effective', deviceId],
    queryFn: () => api<AlarmRuleDto[]>(`/devices/${deviceId}/alarm-rules/effective`),
  });
  const label = (k: string) => profile?.telemetrySchema.find((x) => x.key === k)?.label ?? k;
  return (
    <div className="space-y-6">
      <AlarmsTable base={{ deviceId }} showDevice={false} />
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Rules for this device</h2>
          {hasPerm('alarm.rule.write') && (
            <Button asChild size="sm" variant="outline">
              <Link to={`/alarm-rules?deviceId=${deviceId}`}>Manage rules</Link>
            </Button>
          )}
        </div>
        {rules.length ? (
          <ul className="space-y-1 text-sm">
            {rules.map((r) => (
              <li key={r.id} className="flex items-center gap-2">
                <SeverityBadge severity={r.severity} />
                <span className="font-medium">{r.name}</span>
                <span className="text-slate-500">— {describeRule(r, label)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No alarm rules run for this device.</p>
        )}
      </section>
    </div>
  );
}
