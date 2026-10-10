import { Play } from 'lucide-react';
import { z } from 'zod';
import { field } from '../../forms/fields';
import type { WidgetDefinition } from '../../sdk';
import { buttonClass, parseParams, useAction } from './useAction';

const schema = z.object({
  command: field.text('Command', { max: 64, help: 'A command declared on the device profile' }).default(''),
  label: field.text('Button label', { max: 60 }).optional(),
  params: field.textarea('Parameters (JSON)', { max: 2000 }).optional(),
});
type Settings = z.infer<typeof schema>;

export const commandButton: WidgetDefinition<Settings> = {
  type: 'command-button',
  name: 'Command button',
  description: 'Sends a declared command, asking first when the profile requires confirmation.',
  icon: Play,
  category: 'control',
  settingsSchema: schema,
  data: { mode: null, sources: ['none', 'currentDevice', 'device'] },
  defaultSize: { w: 3, h: 2 },
  Component: ({ settings, profile, device, can, actions }) => {
    const def = profile?.commands.find((c) => c.name === settings.command);
    const label = settings.label || def?.label || settings.command || 'Command';
    const { trigger, busy, ui } = useAction(`Send “${label}” to ${device?.name ?? 'the device'}?`);
    return (
      <div className="flex h-full flex-col justify-center">
        <button
          type="button"
          className={buttonClass}
          disabled={!can.command || !def || busy}
          title={!can.command ? 'You do not have permission to send commands' : !def ? 'Command not declared on this profile' : undefined}
          onClick={() => trigger(() => actions.sendCommand(settings.command, parseParams(settings.params)), def?.confirm ?? true)}
        >
          {label}
        </button>
        {ui}
      </div>
    );
  },
};
