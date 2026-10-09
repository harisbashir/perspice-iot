# Writing widgets

Widgets live in `packages/widgets` (the widget SDK and the built-in library). The web app
consumes the package as TypeScript source. A widget is a React component plus a description of
the data it needs and the settings it takes; the dashboard handles fetching, live updates,
layout, the settings form and errors.

## The contract

```ts
import type { WidgetDefinition } from '../../sdk';

export const myWidget: WidgetDefinition<Settings> = {
  type: 'fuel-dial',              // unique, lower-case, stored in dashboard definitions
  name: 'Fuel dial',              // shown in the widget library
  description: 'A dial for one tank level.',
  icon: Gauge,                    // a lucide-react icon
  category: 'value',              // chart | value | table | control | other
  settingsSchema: schema,         // zod object; drives the settings form
  data: { mode: 'latest', sources: ['currentDevice', 'device'], keys: { min: 1, max: 1 } },
  defaultSize: { w: 3, h: 3 },    // grid units (12 columns, 40 px rows)
  Component: FuelDial,
};
```

### Data

`data.mode` is the request the dashboard makes on the widget's behalf. The result arrives as
`props.result`.

| Mode | Sources | Result (`result.data`) |
|---|---|---|
| `latest` | `currentDevice`, `device` | `{ device, values: { key: { ts, v } } }` |
| `latest` | `devicesOfProfile` | `{ devices: [{ …device, values }] }` |
| `history` | `currentDevice`, `device` | `{ source, series: { key: [[ts, v], …] } }` (aggregated automatically for long windows) |
| `list` | `entityList` | `{ items, total, page, pageSize, customers? }` |
| `stats` | `devicesOfProfile` | `{ total, online, offline, dead, never, messages24h }` |
| `null` | `none` | nothing (content or action-only widgets) |

`result` is `undefined` while loading, `{ ok: true, data }` on success, or `{ ok: false, code,
message }` when this widget's source failed (other widgets still render). Wrap your output in
`<WidgetStatus result={result}>` to get the standard loading, error and empty states. The type
guards `isLatest`, `isFleet`, `isHistory`, `isList` and `isStats` narrow `data`.

Live telemetry and status changes are merged into `result` by the dashboard, so widgets never
open their own subscriptions.

### Settings

Build `settingsSchema` with the `field` helpers. They become the form in the builder's side
panel, and saved settings are parsed with the schema (defaults applied) before reaching
`props.settings`:

```ts
const schema = z.object({
  max: field.number('Tank size', { min: 1, help: 'In the key’s unit' }).default(100),
  colour: field.color('Colour').default('#1D4ED8'),
  style: field.select('Style', ['dial', 'bar'] as const).default('dial'),
  label: field.text('Label', { max: 40 }).optional(),
  compareKey: field.key('Compare with', 'Another telemetry key').optional(),
});
```

### Props

| Prop | Meaning |
|---|---|
| `config` | the widget's stored configuration (title, data source, raw settings) |
| `settings` | parsed settings |
| `result` | data, as above |
| `timewindow` | the dashboard's current time window |
| `device`, `profile` | the device a device dashboard is open for, and its profile (labels, units, decimals) |
| `can` | `{ command, export }` for the viewer |
| `viewer` | `{ scopeType: 'platform' \| 'customer' }`; hide platform-only details from customers |
| `actions` | `sendCommand(name, params)`, `writeShared(values)`, `openDevice(id)`, `setQuery({ page, sort, customerId })` |

Use `formatValue`, `keyDef` and `keyLabel` from `data/format` so values follow the profile's
units and decimals. For charts, render through `EChart`, which loads ECharts on first use,
resizes with the frame and reports when it has drawn (the PDF renderer waits for that).

## Safety

- Never render user-provided HTML directly. Markdown goes through `renderMarkdown`, which
  sanitises with DOMPurify.
- Images must come from uploaded assets (`/api/public/assets/…`) or `https:` URLs.
- Control widgets must respect `can.command` and confirm destructive actions (see `useAction`
  in `library/control`).

## Adding a widget

1. Create the file under `packages/widgets/src/library/<category>/`.
2. Add it to `BUILT_IN_WIDGETS` in `library/index.ts`.
3. Add tests next to the existing ones in `packages/widgets/test` (render with `propsFor` from
   `test/props.ts`), then run `pnpm --filter @perspice/widgets test`.

Changing a widget's `type` breaks dashboards that use it. Add a new type instead and leave the
old one registered.
