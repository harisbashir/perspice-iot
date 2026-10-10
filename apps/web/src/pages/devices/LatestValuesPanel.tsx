import type { DeviceDto, TelemetryKeyDef } from '@perspice/shared';
import { Card, CardContent } from '@/components/ui/card';
import { formatValue, timeAgo } from './format';

/** Latest values, labelled and formatted by the profile; keys not in the profile follow. */
export function LatestValuesPanel({ device, schema }: { device: DeviceDto; schema: TelemetryKeyDef[] }) {
  const latest = device.latest ?? {};
  const known = schema.map((def) => ({ key: def.key, label: def.label, def }));
  const extra = Object.keys(latest)
    .filter((k) => !schema.some((d) => d.key === k))
    .sort()
    .map((key) => ({ key, label: key, def: undefined }));
  const rows = [...known, ...extra];
  if (!rows.length) return <p className="text-sm text-slate-500">No telemetry received yet.</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map(({ key, label, def }) => (
        <Card key={key}>
          <CardContent className="p-4">
            <div className="text-xs font-medium uppercase text-slate-500">{label}</div>
            <div data-testid={`value-${key}`} className="mt-1 text-2xl font-semibold tabular-nums">
              {formatValue(latest[key]?.v, def)}
            </div>
            <div className="mt-1 text-xs text-slate-500">{latest[key] ? timeAgo(latest[key]!.ts) : 'no data'}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
