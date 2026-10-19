import { SignalHigh } from 'lucide-react';
import { z } from 'zod';
import { formatNumber, keyDef } from '../../data/format';
import { WidgetStatus } from '../../data/WidgetStatus';
import { field } from '../../forms/fields';
import type { WidgetDefinition } from '../../sdk';
import { Readout, splitUnit } from '../shared/Readout';
import { firstValue } from '../values/shared';

const schema = z.object({
  scale: field.select('Reading', ['dbm', 'percent', 'csq'] as const, 'RSSI in dBm, a percentage, or a modem CSQ (0–31)').default('dbm'),
});
type Settings = z.infer<typeof schema>;

export const SIGNAL_LABELS = ['No signal', 'Weak', 'Fair', 'Good', 'Excellent'] as const;

/** 0–4 bars. dBm cut-offs follow common Wi-Fi/LTE guidance (−67 excellent … −95 weak); CSQ 99 means unknown. */
export function signalLevel(scale: Settings['scale'], v: number | null): number | null {
  if (v === null) return null;
  const cut = (steps: number[]) => steps.filter((s) => v >= s).length;
  if (scale === 'dbm') return cut([-95, -85, -75, -67]);
  if (scale === 'percent') return cut([20, 40, 60, 80]);
  if (v === 99) return null;
  return cut([2, 10, 15, 20]);
}

const LEVEL_COLOR = ['', 'bg-crit-vivid', 'bg-warn-vivid', 'bg-ok-vivid', 'bg-ok-vivid'];

/** Signal strength as four bars and a word, from RSSI (dBm), a percentage or a modem's CSQ. */
export const signalBars: WidgetDefinition<Settings> = {
  type: 'signal-bars',
  name: 'Signal strength',
  description: 'Radio signal as four bars and a quality word, from RSSI in dBm, a percentage or CSQ.',
  icon: SignalHigh,
  category: 'value',
  settingsSchema: schema,
  data: { mode: 'latest', sources: ['currentDevice', 'device'], keys: { min: 1, max: 1 } },
  defaultSize: { w: 3, h: 3 },
  Component: ({ config, settings, result, profile }) => {
    const { key, num } = firstValue(config, result);
    const level = signalLevel(settings.scale, num);
    const unit = keyDef(profile, key)?.unit ?? (settings.scale === 'dbm' ? 'dBm' : settings.scale === 'percent' ? '%' : undefined);
    return (
      <WidgetStatus result={result}>
        <div className="flex h-full items-end justify-between gap-3 pb-1">
          <div>
            <Readout size="md" {...splitUnit(num === null ? '—' : formatNumber(num, 0, unit), unit)} />
            <div className="mt-1.5 text-xs font-medium text-fg-muted">{level === null ? 'Unknown' : SIGNAL_LABELS[level]}</div>
          </div>
          <div role="meter" aria-label={config.title ?? key} aria-valuemin={0} aria-valuemax={4} aria-valuenow={level ?? 0} aria-valuetext={level === null ? 'Unknown' : SIGNAL_LABELS[level]} className="flex h-9 items-end gap-[3px]">
            {[1, 2, 3, 4].map((b) => (
              <span key={b} className={`w-[7px] rounded-[2px] ${level !== null && b <= level ? LEVEL_COLOR[level] : 'bg-fill-strong'}`} style={{ height: `${b * 25}%` }} />
            ))}
          </div>
        </div>
      </WidgetStatus>
    );
  },
};
