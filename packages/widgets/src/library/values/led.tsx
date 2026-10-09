import { CircleDot } from 'lucide-react';
import { z } from 'zod';
import { WidgetStatus } from '../../data/WidgetStatus';
import { field } from '../../forms/fields';
import type { WidgetDefinition } from '../../sdk';
import { firstValue } from './shared';

const schema = z.object({
  onLabel: field.text('On label', { max: 40 }).default('On'),
  offLabel: field.text('Off label', { max: 40 }).default('Off'),
  onColor: field.color('On colour').default('#16A34A'),
  offColor: field.color('Off colour').default('#94A3B8'),
  threshold: field.number('Threshold', { help: 'For numeric keys: on when the value is above this' }).optional(),
  invert: field.boolean('Invert', 'On when false / below the threshold').default(false),
});
type Settings = z.infer<typeof schema>;

export function ledState(s: Pick<Settings, 'threshold' | 'invert'>, raw: unknown): boolean | null {
  let on: boolean | null;
  if (typeof raw === 'boolean') on = raw;
  else if (typeof raw === 'number') on = s.threshold !== undefined ? raw > s.threshold : raw !== 0;
  else if (typeof raw === 'string') on = ['on', 'true', '1', 'running', 'open'].includes(raw.toLowerCase());
  else on = null;
  return on === null ? null : s.invert ? !on : on;
}

export const ledWidget: WidgetDefinition<Settings> = {
  type: 'led',
  name: 'Status indicator',
  description: 'An LED for a boolean (or a numeric key above a threshold), with text labels.',
  icon: CircleDot,
  category: 'value',
  settingsSchema: schema,
  data: { mode: 'latest', sources: ['currentDevice', 'device'], keys: { min: 1, max: 1 } },
  defaultSize: { w: 3, h: 3 },
  Component: ({ config, settings, result }) => {
    const { raw } = firstValue(config, result);
    const on = ledState(settings, raw);
    const color = on ? settings.onColor : settings.offColor;
    return (
      <WidgetStatus result={result}>
        <div role="status" className="flex h-full items-center gap-3">
          <span aria-hidden className="h-6 w-6 rounded-full shadow-inner" style={{ backgroundColor: on === null ? 'transparent' : color, border: `2px solid ${color}` }} />
          <span className="text-lg font-medium">{on === null ? '—' : on ? settings.onLabel : settings.offLabel}</span>
        </div>
      </WidgetStatus>
    );
  },
};
