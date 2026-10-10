import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { commandButton } from '../src/library/control/command-button';
import { setpointWidget } from '../src/library/control/setpoint';
import { sliderWidget } from '../src/library/control/slider';
import { toggleWidget } from '../src/library/control/toggle';
import { latest, propsFor } from './props';

describe('control widgets', () => {
  it('asks for confirmation when the command requires it', async () => {
    const p = propsFor(commandButton, { datasource: { kind: 'none' }, settings: { command: 'gen_start' } });
    render(<commandButton.Component {...p} />);
    await userEvent.click(screen.getByRole('button', { name: 'Start generator' }));
    expect(p.actions.sendCommand).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(p.actions.sendCommand).toHaveBeenCalledWith('gen_start', {});
  });

  it('sends immediately without confirm and passes JSON params', async () => {
    const p = propsFor(commandButton, { datasource: { kind: 'none' }, settings: { command: 'set_interval', params: '{"seconds":30}' } });
    render(<commandButton.Component {...p} />);
    await userEvent.click(screen.getByRole('button', { name: 'Set interval' }));
    expect(p.actions.sendCommand).toHaveBeenCalledWith('set_interval', { seconds: 30 });
  });

  it('is disabled without device.command', () => {
    render(<commandButton.Component {...propsFor(commandButton, { datasource: { kind: 'none' }, settings: { command: 'reboot' }, can: { command: false } })} />);
    expect(screen.getByRole('button', { name: 'Reboot' })).toBeDisabled();
  });

  it('toggle reflects state and sends the on/off command', async () => {
    const p = propsFor(toggleWidget, {
      datasource: { kind: 'currentDevice', keys: ['gen_running'] },
      settings: { target: 'command', onCommand: 'gen_start', offCommand: 'reboot', confirm: false },
      result: latest({ gen_running: false }),
    });
    render(<toggleWidget.Component {...p} />);
    const sw = screen.getByRole('switch');
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(sw);
    expect(p.actions.sendCommand).toHaveBeenCalledWith('gen_start', {});
  });

  it('setpoint writes a shared attribute; slider sends a command parameter', async () => {
    const sp = propsFor(setpointWidget, { datasource: { kind: 'none' }, settings: { target: 'shared', sharedKey: 'interval', min: 5, max: 600 } });
    render(<setpointWidget.Component {...sp} />);
    await userEvent.type(screen.getByLabelText('Value'), '60');
    await userEvent.click(screen.getByRole('button', { name: 'Set' }));
    expect(sp.actions.writeShared).toHaveBeenCalledWith({ interval: 60 });

    const sl = propsFor(sliderWidget, { datasource: { kind: 'none' }, settings: { target: 'command', command: 'set_interval', paramName: 'seconds', min: 0, max: 100, step: 10 } });
    render(<sliderWidget.Component {...sl} />);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '10' } });
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(sl.actions.sendCommand).toHaveBeenCalledWith('set_interval', { seconds: 10 });
  });
});
