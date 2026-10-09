import { SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { field } from '../../forms/fields';
import type { WidgetDefinition } from '../../sdk';
import { sendValue, targetSettings } from './target';
import { buttonClass, useAction } from './useAction';

const schema = z.object({
  ...targetSettings,
  min: field.number('Minimum').default(0),
  max: field.number('Maximum').default(100),
  step: field.number('Step', { min: 0 }).default(1),
});
type Settings = z.infer<typeof schema>;

export const sliderWidget: WidgetDefinition<Settings> = {
  type: 'slider',
  name: 'Slider',
  description: 'Picks a value in a range and sends it as a command parameter or shared attribute.',
  icon: SlidersHorizontal,
  category: 'control',
  settingsSchema: schema,
  data: { mode: null, sources: ['none', 'currentDevice', 'device'] },
  defaultSize: { w: 4, h: 2 },
  Component: ({ config, settings, can, actions }) => {
    const [value, setValue] = useState(settings.min);
    const { trigger, busy, ui } = useAction(`Set ${config.title ?? 'value'} to ${value}?`);
    return (
      <div className="flex h-full flex-col justify-center gap-2">
        <div className="flex items-center gap-3">
          <input
            type="range"
            aria-label={config.title ?? 'Value'}
            className="flex-1"
            min={settings.min}
            max={settings.max}
            step={settings.step}
            value={value}
            disabled={!can.command}
            onChange={(e) => setValue(Number(e.target.value))}
          />
          <span className="w-12 text-right tabular-nums">{value}</span>
          <button type="button" className={buttonClass} disabled={!can.command || busy} onClick={() => trigger(() => sendValue(settings, actions, value), settings.confirm)}>
            Apply
          </button>
        </div>
        {ui}
      </div>
    );
  },
};
