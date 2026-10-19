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
| `latest` | `devicesOfProfile`, `currentAsset` | `{ devices: [{ …device, values }] }` |
| `history` | `currentDevice`, `device` | `{ source, series: { key: [[ts, v], …] } }` (aggregated automatically for long windows) |
| `list` | `entityList` | `{ items, total, page, pageSize, customers? }` |
| `stats` | `devicesOfProfile`, `currentAsset` | `{ total, online, offline, dead, never, messages24h }` |
| `energy` | `currentDevice`, `device`, `currentAsset` | `{ key, unit, timezone, currency, period, periods: [{ period, consumption, cost }], total, previous }` for the first key; the widget's `range` setting (`today`, `week`, `month`, `year` or `window`) picks the span ([energy.md](energy.md)) |
| `null` | `none` | nothing (content or action-only widgets) |

`result` is `undefined` while loading, `{ ok: true, data }` on success, or `{ ok: false, code,
message }` when this widget's source failed (other widgets still render). Wrap your output in
`<WidgetStatus result={result}>` to get the standard loading, error and empty states. The type
guards `isLatest`, `isFleet`, `isHistory`, `isList`, `isStats` and `isEnergy` narrow `data`.

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

## Gauges

Five gauges are drawn in SVG/HTML (no ECharts), so they're light, sharp at any size and follow the
theme. They live in `library/gauges/`:

| Type | Name | Shows | Notes |
|---|---|---|---|
| `arc-gauge` | Dial | one value on a 240° dial | warning and critical zones drawn on the rim |
| `ring-gauge` | Rings | up to three values as concentric rings | one shared range; colour per ring or by band |
| `bar-gauge` | Segmented meter | one value as lit segments | each segment coloured by the zone it sits in; horizontal or vertical |
| `bar-list` | Ranked bars | one key across devices, or several keys of one device | sorted and limited; fleet rows open the device |
| `signal-bars` | Signal strength | RSSI (dBm), a percentage or a modem CSQ | 0–4 bars and a word (Weak… Excellent) |

Gauges with a range use the shared `rangeSettings` (min, max, decimals, unit, warning and critical
thresholds, "low values are bad") and `bandOf()` from `library/charts/thresholds.ts`.

## Design

Widgets are drawn inside `WidgetFrame` (the card, the title and the export menu come from it) and
follow the web app's design tokens (`apps/web/CLAUDE.md` › Design tokens):

- Colours: `text-fg`, `text-fg-muted`, `bg-fill`, `bg-fill-strong` for tracks; status through
  `BAND_VAR` (CSS variables, for HTML and SVG) or `BAND_COLOR` (hex, for ECharts). No `slate-*`
  and no `dark:` twins: the tokens switch with the appearance.
- Readings: `<Readout text unit />` from `library/shared/Readout.tsx` puts the number in the
  rounded face with the unit smaller, and glows once when the value changes. `splitUnit()` splits a
  `formatValue()` result into the two.
- Size: the frame body is a CSS container, so adapt to the widget's own width with container
  queries (`@[12rem]:text-3xl`; `wideOnly` hides secondary table columns under 28rem). On phones
  dashboards stack widgets two to a row or full width, so a widget can be anything from ~160 px
  wide up.
- Accessibility: a gauge is `role="meter"` with `aria-valuemin/max/now` (and `aria-valuetext` when
  the number alone isn't the reading); colour is never the only signal.

## Safety

- Never render user-provided HTML directly. Markdown goes through `renderMarkdown`, which
  sanitises with DOMPurify.
- Images must come from uploaded assets (`/api/public/assets/…`) or `https:` URLs.
- Control widgets must respect `can.command` and confirm destructive actions (see `useAction`
  in `library/control`).

## Adding a widget

1. Create the file under `packages/widgets/src/library/<category>/`, following Design above.
2. Add it to `BUILT_IN_WIDGETS` in `library/index.ts`.
3. Add tests next to the existing ones in `packages/widgets/test` (render with `propsFor` from
   `test/props.ts`), then run `pnpm --filter @perspice/widgets test`.
4. Add it to the widget table in `apps/web/src/help/content/dashboard-templates.md`, and look at it
   in demo mode (`apps/web/CLAUDE.md`): the demo dashboards in `apps/web/src/demo/fixtures.ts` are
   the place to show a new widget at phone and desktop width.

Changing a widget's `type` breaks dashboards that use it. Add a new type instead and leave the
old one registered.
