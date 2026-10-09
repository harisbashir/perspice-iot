import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AutoForm } from '../src/forms/AutoForm';
import { field } from '../src/forms/fields';
import { type WidgetDefinition, clearRegistry, getWidget, listWidgets, registerWidget } from '../src/sdk';

const def = (type: string, category: WidgetDefinition['category'] = 'value'): WidgetDefinition =>
  ({
    type,
    name: type,
    description: '',
    icon: () => null,
    category,
    settingsSchema: z.object({}),
    data: { mode: 'latest', sources: ['currentDevice'] },
    defaultSize: { w: 3, h: 3 },
    Component: () => null,
  }) as WidgetDefinition;

describe('widget registry', () => {
  it('registers, finds and lists by category; rejects duplicates', () => {
    clearRegistry();
    registerWidget(def('a'));
    registerWidget(def('b', 'chart'));
    expect(getWidget('a')?.type).toBe('a');
    expect(getWidget('missing')).toBeUndefined();
    expect(listWidgets('chart').map((w) => w.type)).toEqual(['b']);
    expect(() => registerWidget(def('a'))).toThrow(/already registered/);
  });
});

const schema = z.object({
  label: field.text('Label').default('Fuel'),
  decimals: field.number('Decimals', { min: 0, max: 6 }).default(1),
  showTrend: field.boolean('Show trend').default(true),
  size: field.select('Size', ['small', 'large']).default('small'),
  color: field.color('Colour').default('#0F766E'),
});

describe('AutoForm', () => {
  it('renders a field per setting with its current value', () => {
    render(<AutoForm schema={schema} value={schema.parse({})} onChange={() => undefined} />);
    expect(screen.getByLabelText('Label')).toHaveValue('Fuel');
    expect(screen.getByLabelText('Decimals')).toHaveValue(1);
    expect(screen.getByLabelText('Show trend')).toBeChecked();
    expect(screen.getByLabelText('Size')).toHaveValue('small');
    expect(screen.getByLabelText('Colour')).toHaveValue('#0F766E');
  });

  it('emits parsed values on change', async () => {
    const onChange = vi.fn();
    render(<AutoForm schema={schema} value={schema.parse({})} onChange={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText('Size'), 'large');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ size: 'large', decimals: 1 }));
    await userEvent.click(screen.getByLabelText('Show trend'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ showTrend: false }));
  });

  it('shows the validation message and does not emit invalid values', async () => {
    const onChange = vi.fn();
    render(<AutoForm schema={schema} value={schema.parse({})} onChange={onChange} />);
    const decimals = screen.getByLabelText('Decimals');
    await userEvent.clear(decimals);
    await userEvent.type(decimals, '9');
    expect(screen.getByRole('alert')).toHaveTextContent(/6/);
    expect(onChange).not.toHaveBeenLastCalledWith(expect.objectContaining({ decimals: 9 }));
  });
});
