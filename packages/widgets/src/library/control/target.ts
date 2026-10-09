import { field } from '../../forms/fields';
import type { WidgetActions } from '../../sdk';

/** Where a control sends its value: a command parameter or a shared attribute. */
export const targetSettings = {
  target: field.select('Send to', ['command', 'shared']).default('shared'),
  command: field.text('Command', { max: 64 }).optional(),
  paramName: field.text('Command parameter', { max: 64 }).default('value'),
  sharedKey: field.text('Shared attribute', { max: 64 }).optional(),
  confirm: field.boolean('Ask for confirmation').default(false),
};

export function sendValue(
  s: { target: 'command' | 'shared'; command?: string; paramName: string; sharedKey?: string },
  actions: WidgetActions,
  value: unknown,
): Promise<void> {
  if (s.target === 'command') {
    if (!s.command) return Promise.reject(new Error('No command configured'));
    return actions.sendCommand(s.command, { [s.paramName]: value });
  }
  if (!s.sharedKey) return Promise.reject(new Error('No shared attribute configured'));
  return actions.writeShared({ [s.sharedKey]: value });
}
