import { ToggleRight } from 'lucide-react';
import { z } from 'zod';
import { field } from '../../forms/fields';
import type { WidgetDefinition } from '../../sdk';
import { ledState } from '../values/led';
import { firstValue } from '../values/shared';
import { useAction } from './useAction';

const schema = z.object({
  target: field.select('Send to', ['command', 'shared']).default('command'),
  onCommand: field.text('On command', { max: 64 }).optional(),
  offCommand: field.text('Off command', { max: 64 }).optional(),
  sharedKey: field.text('Shared attribute', { max: 64 }).optional(),
  confirm: field.boolean('Ask for confirmation').default(true),
});
type Settings = z.infer<typeof schema>;

export const toggleWidget: WidgetDefinition<Settings> = {
  type: 'toggle',
  name: 'Toggle',
  description: 'Shows an on/off state and switches it with commands or a shared attribute.',
  icon: ToggleRight,
  category: 'control',
  settingsSchema: schema,
  data: { mode: 'latest', sources: ['currentDevice', 'device'], keys: { min: 1, max: 1 } },
  defaultSize: { w: 3, h: 2 },
  Component: ({ config, settings, result, can, actions }) => {
    const { raw } = firstValue(config, result);
    const on = ledState({ invert: false }, raw) ?? false;
    const { trigger, busy, ui } = useAction(`Switch ${on ? 'off' : 'on'}?`);
    const send = () => {
      if (settings.target === 'shared') return actions.writeShared({ [settings.sharedKey ?? '']: !on });
      const cmd = on ? settings.offCommand : settings.onCommand;
      return cmd ? actions.sendCommand(cmd, {}) : Promise.reject(new Error('No command configured'));
    };
    return (
      <div className="flex h-full flex-col justify-center">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={config.title ?? 'Toggle'}
          disabled={!can.command || busy}
          onClick={() => trigger(send, settings.confirm)}
          className={`relative h-7 w-12 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-ok-vivid' : 'bg-fill-strong'}`}
        >
          <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
        {ui}
      </div>
    );
  },
};
