# apps/web: the React front end

React 18 + Vite 6 + Tailwind 3 + TanStack Query 5 + React Router 7. Radix primitives sit under
`src/components/ui`; dashboards render widgets from `packages/widgets`. One app serves both portals
(platform and customer): what someone sees follows their permissions (`useAuth().hasPerm`).

## Run it without a server: demo mode

```bash
pnpm --filter @perspice/web dev:demo     # http://localhost:5173, signed in as a platform admin
```

`vite --mode demo` mocks the API in the browser with MSW (`src/demo/handlers.ts`) and swaps the
realtime socket for a stand-in that pushes a reading for every online device every 4 s
(`src/demo/socket.ts`, wired by the alias in `vite.config.ts`). The data in `src/demo/fixtures.ts`
is a small telecom fleet: 6 Telecom RMS sites and 3 cold rooms, alarms, two customers. Its
dashboards come from the generators the server seeds with (`packages/shared/src/dashboard-defaults.ts`) plus a
"Site" view on the RMS dashboard and a "Sites" view on the overview that use every gauge. Endpoints
without a handler return `[]` for reads and `{ ok: true }` for writes. If a page crashes in demo mode,
it is usually missing a handler that returns the right shape; add one rather than guarding the page.
Demo code is dropped from production builds (`import.meta.env.DEMO` is false there).

Ports: 5173 is also the normal `pnpm dev` port (which proxies `/api` to a server on :3000). Pass
`--port` to run both.

## Look at the result: screenshots

```bash
node e2e/screenshots.mjs http://localhost:5173 /tmp/shots            # main pages, phone + desktop, light + dark
ALL=1 node e2e/screenshots.mjs http://localhost:5173 /tmp/shots phone-light   # every section, one variant
```

Phone is 390×844 with touch (so `touch:` styles apply), desktop 1440×900. Page errors are printed
with stacks. Full-page shots draw fixed bars (tab bar, sidebar) where the viewport was, mid-page;
that's an artefact of the screenshot, not a layout bug. Check every new screen at phone width: an
image wider than 390 px, or content cut at the right edge, means something doesn't shrink (see
Gotchas). Playwright needs a browser: `npx playwright install chromium-headless-shell` from `e2e/`.

## Layout

- `src/layout/AppShell.tsx`: from `lg` (1024 px) a fixed 240 px **sidebar** (`Sidebar.tsx`); below
  it a **tab bar** at the bottom (`TabBar.tsx`, Overview / Devices / Alarms / More, the rest in a
  sheet). Only one is rendered (`useMediaQuery(DESKTOP_QUERY)`), so tests and screen readers meet
  the navigation once. The sticky translucent **top bar** (`Topbar.tsx`) has help, notifications
  and the account menu, which holds the Appearance setting (system / light / dark).
- Navigation items, their groups and which are tabs: `src/layout/nav.ts`. Permissions filter them
  in `useNavItems.ts`.
- Pages start with `PageHeader` (large title, description, actions that wrap below on phones,
  `children` for a status line).
- `main` has bottom padding for the tab bar and safe area; the shell clips sideways overflow
  (`overflow-x-clip`) as a last resort. Don't rely on that: content that's too wide is cut off.

## Design tokens

The redesign follows Apple's HIG (grouped surfaces, system type, semantic colours) with one
signature: rings. KPI tiles carry a ring showing their share of the fleet, the Rings widget, and
the sign-in background. Readings use the rounded face and glow once when they change (the "live
pulse").

Colours are CSS variables in `src/index.css` (`:root` light, `.dark` dark) exposed as Tailwind
colours in `tailwind.config.ts`. **Use these, never `slate-*`, `gray-*` or `white`/`black` for
surfaces and text.** They switch for dark mode by themselves, so no `dark:` twin is needed.

| Token | Use | Light / dark |
|---|---|---|
| `bg-canvas` | page background | #F2F2F7 / #000000 |
| `bg-surface` | cards, sheets, menus | #FFFFFF / #1C1C1E |
| `bg-surface-2` | a surface on a surface (menus and dialogs in dark mode) | #FFFFFF / #2C2C2E |
| `bg-fill`, `bg-fill-strong` | control and hover fills; tracks and skeletons (no text on `-strong`) | |
| `border-line`, `border-line-strong` | hairlines; control borders (3:1 on surface) | |
| `text-fg`, `text-fg-2`, `text-fg-muted` | primary, body copy, secondary (≥ 4.5:1 on surface, canvas and fill) | |
| `text-ok/warn/crit/info` | status text (≥ 5:1 on surface and on its tint) | |
| `bg-*-tint` | status badge backgrounds | |
| `bg-*-vivid` | dots, bars, rings: marks only, not text | |
| `primary-50…950` | the tenant's brand colour (white-label, set at runtime by `applyTheme`) | |

Rules that keep it consistent:

- The brand colour is for primary actions, the current nav item, links and focus. Status uses the
  status tokens. Colour never carries meaning alone: badges have words, gauges have numbers.
- Cards: `Card` (rounded-xl, `shadow-card`, no border). Dialogs are bottom sheets on phones and
  centred panels from `sm` (`DialogContent`). `DialogFooter` stacks full-width buttons on phones.
- Controls are 36 px tall with a pointer and 44 px on touch screens (the `touch:` variant is
  `@media (pointer: coarse)`). Native `<select>`, `<input>` and `<textarea>` get the look, the
  44 px minimum and 16 px text on touch (no iOS zoom) from `index.css`, so plain elements are fine.
- Type: system font (`font-sans`), readings in `font-rounded` with `tabular-nums`. Page titles 28–30
  px bold, card titles 17 px semibold, body 15 px, secondary 13 px. Nothing under 11 px.
- Charts use the themes in `packages/widgets/src/library/charts/theme.ts` (canvas can't read CSS
  variables, so the hex values are repeated there; keep them in step with `index.css`).
- Motion: short, and off under `prefers-reduced-motion` (global rule in `index.css`).
  `.glass` (translucent bars) turns solid under `prefers-reduced-transparency`.
- Some older screens still use explicit Tailwind palette colours with `dark:` twins (System,
  Import, the dashboard editor). They work; move them to tokens when you touch them.

## Phones

- Dashboards: below `md` (768 px) `DashboardGrid` doesn't use react-grid-layout. It stacks widgets
  in reading order, two narrow ones (≤ 3 columns) per row, with heights from the grid rows (short
  tiles 112 px, tall ones capped at 560). The rules are in `stackedLayout()` and its test. The
  builder always uses the grid.
- Lists, not tables: `DevicesTable` and `AlarmsTable` render `ListRows`/`ListRow` below `md`. Do the
  same for new primary lists. A wide table elsewhere is fine inside `Table`, which scrolls sideways
  within its card.
- Rows of tabs or chips use `.scroll-row` (scroll sideways, no wrapping, no scrollbar).
- Widgets adapt to their own width with container queries: `WidgetFrame`'s body is `@container`,
  so use `@[12rem]:text-3xl`, or `wideOnly` in widget tables to hide secondary columns while the
  widget is narrower than 28rem.

## Data and realtime

- API: `api<T>(path, { body, query, method })` in `src/api/client.ts` (adds the token, refreshes it,
  throws `ApiError`). Server state lives in TanStack Query; query keys are listed in the hooks next
  to each page (`pages/devices/hooks.ts` etc.).
- Realtime: `src/realtime/socket.ts` (Socket.IO). Always import it as `@/realtime/socket`: the
  tests mock that path and demo mode aliases it, so a relative import silently bypasses both.
- Dashboards fetch every widget's data in one `POST /dashboards/data` and merge live events into it
  (`src/dashboards/useDashboardData.ts`, `live.ts`). `data-live` on widgets and the device page
  turns true once updates are live; e2e tests wait for it before publishing.

## Tests

`pnpm --filter @perspice/web test` (Vitest + Testing Library + MSW, jsdom). `src/test/render.tsx`
`renderApp(path, { user })` renders the whole app at a route. jsdom has no `matchMedia`, so
`useMediaQuery` reports its fallback (`true`): **unit tests always see the desktop layout**
(sidebar, tables, grid). Phone layouts are covered by `stackedLayout.test.ts` and by looking at
screenshots. CSS isn't loaded in tests, so assert on roles and text, not classes.

## Gotchas

- `grid`/`flex` children don't shrink below their content's width unless told to. Inputs had a
  ~150 px intrinsic minimum that pushed cards past a phone's edge; `index.css` now sets
  `min-width: 0` on fields and `Card` has `min-w-0`. For grids with fixed columns (the profile key
  editors), give the rows a `min-w-[…]` and let the container `overflow-x-auto`.
- An effect must return a function or nothing: `useEffect(() => window.scrollTo(0, 0))` crashed
  on phones ("destroy is not a function"). Use a block body.
- react-grid-layout's `WidthProvider` only re-measures on window resize; `DashboardGrid` measures
  its own width with a ResizeObserver instead. Leaflet maps need `invalidateSize()` when their frame
  resizes (`watchSize` in the map widget).
- Never import from `apps/server` in the web app: the web Docker image only contains `apps/web`
  and `packages/*`, so the build in CI (smoke, e2e) fails even though local typecheck passes. Move
  shared code to `packages/shared`.
- `tailwind.config.ts` changes need a dev-server restart.
- Tailwind's `animate-pulse` is the skeleton shimmer; the reading glow is `animate-live`.
- The repo isn't Prettier-clean; don't run `prettier --write` over whole folders, it reformats
  hundreds of untouched lines. Match the surrounding style (lines up to ~160 characters).
