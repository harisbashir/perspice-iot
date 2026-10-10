import { Target } from 'lucide-react';
import { useId, useState } from 'react';
import { z } from 'zod';
import { field } from '../../forms/fields';
import type { WidgetDefinition } from '../../sdk';
import { sendValue, targetSettings } from './target';
import { buttonClass, useAction } from './useAction';

const schema = z.object({ ...targetSettings, min: field.number('Minimum').optional(), max: field.number('Maximum').optional() });
type Settings = z.infer<typeof schema>;

export const setpointWidget: WidgetDefinition<Settings> = {
  type: 'setpoint',
  name: 'Set-point',
  description: 'Types a number and sends it as a command parameter or shared attribute.',
  icon: Target,
  category: 'control',
  settingsSchema: schema,
  data: { mode: null, sources: ['none', 'currentDevice', 'device'] },
  defaultSize: { w: 3, h: 2 },
  Component: ({ config, settings, can, actions }) => {
    const id = useId();
    const [text, setText] = useState('');
    const value = Number(text);
    const valid = text !== '' && Number.isFinite(value) && (settings.min === undefined || value >= settings.min) && (settings.max === undefined || value <= settings.max);
    const { trigger, busy, ui } = useAction(`Set ${config.title ?? 'value'} to ${text}?`);
    return (
      <div className="flex h-full flex-col justify-center">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label htmlFor={id} className="text-xs text-slate-500">
              Value
            </label>
            <input
              id={id}
              type="number"
              min={settings.min}
              max={settings.max}
              disabled={!can.command}
              className="h-9 w-full rounded-md border border-slate-300 bg-transparent px-2 text-sm dark:border-slate-700"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <button type="button" className={buttonClass} disabled={!can.command || !valid || busy} onClick={() => trigger(() => sendValue(settings, actions, value), settings.confirm)}>
            Set
          </button>
        </div>
        {ui}
      </div>
    );
  },
};
