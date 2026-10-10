# Perspice IoT — Sub-project 2: Dashboards & Widgets Implementation Plan

> **For agentic workers:** execute task by task. Each task is test-first (write the failing test, see it fail, implement, see it pass) and ends with one conventional commit. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v0.2.0: platform admins design dashboard templates per device profile in a drag-and-drop builder; one template serves every device of the profile across customers (success criterion 4); customers can customise their copy; both portals open on an overview dashboard; widgets update live; any table/chart and telemetry history exports to CSV/XLSX/PDF; whole dashboards render to branded PDF reports.

**Architecture:** builds on sub-project 1 (v0.1.0). New server modules `dashboards`, `exports`, `reports`; new shared package `packages/widgets` (widget plugin SDK + v1 library, consumed by `apps/web` as TypeScript source); a new process role `renderer` (Playwright Chromium) in its own image for PDF rendering.

**Tech additions:** react-grid-layout 1.x (builder grid), exceljs (XLSX), pdfmake (tabular PDF), Playwright Chromium (dashboard PDF, `renderer` role only), DOMPurify (already used server-side; added client-side for markdown/HTML cards), marked (markdown).

**Spec:** `docs/superpowers/specs/2026-10-08-perspice-iot-design.md` §7 (dashboards, widgets, export), §13 row 2.

## Scope decisions

The spec's §7 widget list includes items whose data arrives in later sub-projects. They are **deferred**, with their plugin slots reserved:

| Deferred | Reason | Lands in |
|---|---|---|
| Alarm table, event/alarm timeline, "active alarms" KPI, recent-alarms list, `alarms(filter)` data source | no alarms until sub-project 3 | 3 |
| Scheduled reports (`report_schedule`, cron delivery) | listed under sub-project 3 | 3 |
| Map widget, route playback, geofence overlay, location column | location data is sub-project 5 | 5 |
| `asset` template kind and `asset(A).children` data source | assets are sub-project 5 | 5 |
| Energy summary widget | energy features are sub-project 5 | 5 |

Everything else in §7 is in scope.

## Global Constraints

- Every data-source query is constrained by the viewer's scope through `ScopedRepo` / `DevicesService.find`; a widget can never read another tenant's device, even with a hand-edited definition (Review Focus 1).
- Dashboard definitions are validated with the shared zod schema on every write (template, override, import); unknown widget types are kept but rendered as "Unknown widget" (forward compatibility).
- Markdown/HTML cards are sanitised with DOMPurify in the browser; image overlays accept only uploaded assets or `https:` URLs (Review Focus 3).
- Live updates reuse the realtime gateway; a client subscribes to at most 500 devices at once.
- Exports: synchronous up to 50,000 rows (streamed, never fully buffered); above that a background `export_job` with an in-app notification and an `export_ready` email linking to a signed URL valid 24 h; expired files are deleted (Review Focus 4).
- Template version increments on every template write; an overridden instance records the template version it was copied from so the UI can say "template changed since you customised" (Review Focus 2).
- New permissions: `dashboard.edit` (templates; platform roles `super_admin`, `platform_admin`), `dashboard.customize` (customer instance overrides; `customer_admin`). Viewing a dashboard needs `device.read` (device dashboards) or nothing beyond sign-in (overview).

## Review Focus

1. **Cross-tenant data via datasource** — a customer edits their override (or the API request) to reference another customer's device id or a profile they don't own. Expect: data endpoints return 404 for that widget's source; list sources silently exclude out-of-scope devices. Test in Task 6.
2. **Template drift** — a template is edited after customer C customised it. Expect: C keeps its override; `GET` returns `templateVersion > baseVersion` and the UI offers "Re-sync". Uncustomised instances see the change immediately. Test in Task 4.
3. **Hostile widget content** — markdown with `<script>`, `<img onerror>`, `javascript:` links; image widget pointing at `http://` or `data:` URLs. Expect: stripped / rejected. Test in Tasks 9 and 10.
4. **Huge exports** — 2 million rows requested. Expect: background job, bounded memory (streaming), file expires after 24 h, other users can't download it (signed per-user link). Test in Task 13.
5. **Renderer token leak** — the print route the renderer loads must not be usable by anyone else. Expect: one-time render token, 60 s TTL, bound to one dashboard + viewer scope. Test in Task 14.

---

## File Structure (new or substantially changed)

```
packages/shared/src/dashboard.ts          definition schema, datasource & timewindow types
packages/widgets/src/
  sdk.ts                                  WidgetDefinition contract, registry
  forms/AutoForm.tsx                      zod schema → settings form
  data/                                   useWidgetData (query + live merge), format helpers
  library/charts/*.tsx                    line/area, bar, pie, radial gauge, linear gauge, heatmap, sparkline
  library/values/*.tsx                    value card, multi-value, LED, progress, battery, tank
  library/tables/*.tsx                    latest values, history table, entity table
  library/control/*.tsx                   button, toggle, slider, set-point
  library/other/*.tsx                     markdown card, image overlay
  index.ts                                registerBuiltInWidgets()
apps/server/src/dashboards/               templates, instances, assignment, data query, defaults
apps/server/src/exports/                  csv/xlsx/pdf writers, export jobs, download controller
apps/server/src/reports/                  render tokens, report requests, renderer worker
apps/web/src/dashboards/                  DashboardView, Builder, dialogs (clone/import/key-mapping)
deploy/Dockerfile.renderer                Playwright-based renderer image
```

---

### Task 1: Shared dashboard contracts and permissions

**Files:** `packages/shared/src/dashboard.ts`, `permissions.ts`, `roles.ts`; tests `packages/shared/test/dashboard.test.ts`, `roles.test.ts` (extend)

**Interfaces:**
- `Timewindow = { kind: 'relative'; lastMs: number } | { kind: 'absolute'; fromMs: number; toMs: number }`.
- `DataSource = { kind: 'currentDevice'; keys: string[] } | { kind: 'device'; deviceId: string; keys: string[] } | { kind: 'devicesOfProfile'; profileId: string | null; filter?: { status?: DeviceStatus[]; tags?: string[]; search?: string }; keys: string[] } | { kind: 'entityList'; profileId: string | null; filter?; columns: string[]; pageSize: number } | { kind: 'none' }`.
- `WidgetConfig = { id; type; title?; datasource: DataSource; settings: Record<string, unknown> }`; `LayoutItem = { i; x; y; w; h }` (12-column grid).
- `DashboardState = { id; name; layout: LayoutItem[]; widgets: WidgetConfig[] }`; `DashboardDefinition = { states: DashboardState[] (≥1); settings: { timewindow: Timewindow; refreshS: number } }` as zod `DashboardDefinitionSchema` (max 20 states, 60 widgets per state, ids unique, every layout item matches a widget).
- `PERMISSIONS` gains `dashboard.edit`, `dashboard.customize`; built-ins: super/platform admin both, `customer_admin` `dashboard.customize`, support none.

- [ ] Tests: valid definition parses; duplicate widget ids, layout item without widget, 21 states → fail; `canGrant(customer_admin, ['dashboard.customize'])`; platform admin holds both new permissions; customer roles never hold `dashboard.edit`.
- [ ] Implement; `seedRoles` already upserts built-in permissions from code.
- [ ] Commit `feat(shared): dashboard definition schema and dashboard permissions`.

### Task 2: Database schema

**Files:** `apps/server/src/db/schema/dashboards.ts`, migration `0003_dashboards.sql` (generated), extend `devices.ts`
- `dashboard_template (id, name, kind 'device'|'overview', profile_id null FK cascade, definition jsonb, version int default 1, built_in bool, timestamps)`.
- `dashboard_instance (id, template_id FK cascade, customer_id null FK cascade, override_definition jsonb null, override_base_version int null, timestamps, unique(template_id, customer_id) nulls not distinct)`.
- `device_profile.default_dashboard_template_id` (FK set null).
- `export_job (id, user_id FK cascade, customer_id null, kind, params jsonb, status 'queued'|'running'|'done'|'failed', row_count, file_key, error, expires_at, timestamps)`.
- [ ] Test (`db.test.ts` extend): tables exist; unique instance per (template, customer) including null customer.
- [ ] Commit `feat(server): dashboard and export job schema`.

### Task 3: Template API — CRUD, versioning, clone with key mapping, import/export

**Files:** `apps/server/src/dashboards/{templates.service.ts,templates.controller.ts,key-mapping.ts}`
- `GET/POST/PATCH/DELETE /api/dashboard-templates[/:id]` (`dashboard.edit`, platform scope for writes; customers can `GET` templates used by their instances only — 404 otherwise). Every PATCH of `definition` increments `version`. Built-in templates editable but not deletable.
- `POST /:id/clone {name, profileId?, keyMapping?: Record<string,string>}` → copies the definition rewriting `keys`/`columns` through the mapping (`remapKeys(definition, mapping)` pure).
- `GET /:id/export` → `{ format: 'perspice-dashboard', version: 1, template: {name, kind, definition} }`; `POST /import` validates the envelope + schema.
- `PUT /api/device-profiles/:id/default-dashboard {templateId|null}` (`dashboard.edit`).
- [ ] Tests: version increments; clone remaps keys in every datasource and leaves others; import rejects bad envelope/schema with 400; customer `GET` of an unrelated template → 404; profile default set.
- [ ] Commit `feat(dashboards): template CRUD, versioning, clone, import/export`.

### Task 4: Instances, assignment, customise / re-sync

**Files:** `apps/server/src/dashboards/{instances.service.ts,dashboards.controller.ts}`, hook in `DevicesService` create/update
- `ensureInstance(templateId, customerId|null)` idempotent; called when a device is created or reassigned with a customer and its profile has a default template (in the same request, after commit).
- `GET /api/dashboards/device/:deviceId` (`device.read`; device via scoped find) → `{ instanceId, templateId, templateVersion, overridden, baseVersion, definition }` using the device's profile default template and the device's customer instance (creating it lazily if missing). `GET /api/dashboards/overview` → the platform overview template's instance for platform users, the customer's for customer users.
- `PUT /api/dashboard-instances/:id/override {definition}` (`dashboard.customize`, own customer → 404 otherwise; platform users may override any instance); `DELETE /:id/override` = re-sync.
- [ ] Tests: creating a device for customer C with a profile default creates exactly one instance; second device reuses it; **Review Focus 2** drift flags; customer B cannot override customer A's instance (404); viewer cannot customise (403); isolation-suite entries for `GET /dashboards/device/:id` and override endpoints.
- [ ] Commit `feat(dashboards): per-customer instances with customise and re-sync`.

### Task 5: Default templates

**Files:** `apps/server/src/dashboards/defaults.ts`, seed integration
- `generateDeviceTemplate(profile)` → one state: value cards for numeric keys (unit/decimals), LED for booleans, a line chart of all numeric keys (24 h), latest-values table, a control button per declared command.
- Built-in overview template (kind `overview`, `built_in`): KPI value cards (total / online / offline / dead / never, messages in last 24 h) bound to a `fleetStats` pseudo-key on the `devicesOfProfile(null)` source; entity table (status, name, profile, customer for platform, last seen, key columns), click-through to device dashboards.
- `POST /api/device-profiles/:id/generate-dashboard` (`dashboard.edit`) creates + sets default. `seed` creates the overview template and defaults for seeded profiles (idempotent).
- [ ] Tests: generated definition validates and contains a widget per key/command; seed twice → one overview template.
- [ ] Commit `feat(dashboards): generated device dashboards and built-in overview`.

### Task 6: Widget data query API

**Files:** `apps/server/src/dashboards/{data.service.ts,data.controller.ts}`
- `POST /api/dashboards/data { deviceId?: string, requests: [{ widgetId, datasource, mode: 'latest'|'history'|'list'|'stats', timewindow?, agg?, page?, sort? }] }` → `{ results: Record<widgetId, { ok: true, data } | { ok: false, code }> }`. `currentDevice` resolves to `deviceId` (must be in scope). History reuses `TelemetryService.history`; list returns scoped devices with latest values for `keys`/`columns`, paginated, sortable by name/status/lastSeen/key; stats returns status counts and messages in last 24 h (from `telemetry_1h` counts).
- [ ] Tests: **Review Focus 1** — `device` source with another tenant's id → that widget `{ok:false, code:'NOT_FOUND'}` while others succeed; list source for a profile with devices in two customers returns only own; stats scoped; history uses aggregates for 7 d.
- [ ] Commit `feat(dashboards): batched widget data API with scope enforcement`.

### Task 7: Live subscriptions for dashboards

**Files:** `apps/server/src/realtime/realtime.gateway.ts`, `apps/web/src/realtime/*`
- `subscribe:devices {deviceIds[≤500]}` → one scoped query; joins rooms for in-scope ids; ack `{ ok, joined: string[], rejected: string[] }`; `unsubscribe:devices`.
- [ ] Tests: mixed ids → only own joined; 501 ids → `{ok:false, code:'VALIDATION'}`; telemetry for a joined device arrives.
- [ ] Commit `feat(realtime): bulk device subscriptions for dashboards`.

### Task 8: Widget plugin SDK

**Files:** `packages/widgets/{package.json,src/sdk.ts,src/forms/AutoForm.tsx,src/data/*}`; web alias
- `WidgetDefinition<S> = { type; name; icon; category: 'chart'|'value'|'table'|'control'|'other'; settingsSchema: ZodObject<S>; data: { modes: ('latest'|'history'|'list'|'stats'|'none')[]; sources: DataSource['kind'][]; keys?: { min: number; max: number } }; defaultSize: { w; h }; Component: FC<WidgetProps<S>> }`; `WidgetProps = { config; settings; data; timewindow; device?; profile?; onCommand?; onWriteShared?; can: { command: boolean } }`.
- `registerWidget`, `getWidget`, `listWidgets`; `AutoForm` renders zod string/number/boolean/enum/array-of-enum/color (via `.describe('color')`) with labels from `.describe()`.
- [ ] Tests (Vitest + Testing Library): registry rejects duplicate types; AutoForm renders fields from a schema and emits parsed values; invalid input shows the zod message.
- [ ] Commit `feat(widgets): widget plugin SDK and settings auto-form`.

### Task 9: Widget library — charts

Line/area (multi-series, optional second axis), bar, pie/donut, radial gauge, linear gauge, heatmap (time × key), sparkline — ECharts via a shared lazy `EChart` wrapper.
- [ ] Tests: each widget's settings schema has defaults; option builders (pure `buildOption(settings, data)`) produce expected series/axes; gauge clamps to min/max; heatmap buckets by hour.
- [ ] Commit `feat(widgets): chart widgets`.

### Task 10: Widget library — values, tables, control, other

Value card (trend vs previous value), multi-value card, LED/status, progress bar, battery, tank/level; latest-values table, history table, entity table (sortable, paginated, click-through, status badge); button, toggle, slider, set-point (declared commands with params or shared-attribute writes, confirm dialog, hidden or disabled without `device.command`); markdown card (marked + DOMPurify), image with value overlays (positioned labels).
- [ ] Tests: value formatting with decimals/unit; LED thresholds; control widgets hidden without permission and confirm before sending; **Review Focus 3** markdown with `<script>`, `onerror`, `javascript:` stripped; image widget rejects `http:`/`data:` URLs.
- [ ] Commit `feat(widgets): value, table, control and content widgets`.

### Task 11: Dashboard runtime UI

**Files:** `apps/web/src/dashboards/{DashboardView.tsx,TimewindowPicker.tsx,useDashboardData.ts,WidgetFrame.tsx}`
- Renders the active state on a 12-column grid (react-grid-layout static), state tabs, timewindow picker (1 h/24 h/7 d/30 d/custom) and refresh; batches all widget requests into one `/dashboards/data` call; subscribes to the devices shown and merges live telemetry/status; per-widget error boundary; "Unknown widget" placeholder.
- Device page gets a **Dashboard** tab (default when the profile has a template); `/` renders the overview dashboard.
- [ ] Tests: renders widgets from a definition; switching state renders the other layout; a live telemetry event updates a value card without refetch; a widget throwing shows its error frame only; unknown type placeholder.
- [ ] Commit `feat(web): dashboard runtime with live data`.

### Task 12: Dashboard builder UI

**Files:** `apps/web/src/dashboards/builder/*`, route `/dashboards`, `/dashboards/:templateId/edit`
- Template list (create, clone with key-mapping dialog, import/export JSON, set as profile default, generate from profile). Editor: drag/resize grid, widget palette by category, settings panel (AutoForm + datasource editor with key picker from the profile's telemetry schema), states add/rename/reorder, preview against a chosen device, save (version shown), unsaved-changes guard.
- Customer side: on a device dashboard with `dashboard.customize`, "Customise for my organisation" opens the same editor on the instance override; "Re-sync with template" with the drift banner.
- [ ] Tests: adding a widget from the palette places it in free space; settings change updates preview; key-mapping dialog lists unmatched keys; save sends the validated definition; customise → override PUT, re-sync → DELETE.
- [ ] Commit `feat(web): dashboard builder, templates and customer customisation`.

### Task 13: Exports — CSV, XLSX, PDF and background jobs

**Files:** `apps/server/src/exports/*`
- `POST /api/exports {kind: 'telemetry'|'widget'|'devices'|'audit', params, format: 'csv'|'xlsx'|'pdf'}` (`export.data`; audit kind needs `audit.read`). Count first: ≤ 50,000 rows → streamed response (`Content-Disposition`), CSV via streaming writer, XLSX via `exceljs` streaming workbook, PDF via `pdfmake` with the tenant's branding (logo, colours, product name) header/footer. > 50,000 → `export_job` (BullMQ `exports` queue, `scheduler` role) → storage `exports/<userId>/<jobId>.<ext>` → in-app notification + `export_ready` email with a signed URL (24 h); `GET /api/exports/:id` status; cleanup job removes expired files and rows hourly.
- Web: export menu on chart/table widgets, device History tab, devices list, audit page.
- [ ] Tests: CSV/XLSX contents for a known telemetry set (parse back with exceljs); PDF starts with `%PDF` and includes the product name; **Review Focus 4** 60,000 rows → 202 job, job completes, file downloadable by owner only, link expires (fake clock), cleanup deletes file; customer cannot export another tenant's device (404).
- [ ] Commit `feat(exports): CSV, XLSX and PDF exports with background jobs`.

### Task 14: Dashboard PDF reports (renderer role)

**Files:** `apps/server/src/reports/*`, `apps/web/src/print/PrintDashboard.tsx`, `deploy/Dockerfile.renderer`, compose service `renderer`
- `POST /api/reports/dashboard {deviceId?|overview, stateId?, timewindow}` (`export.data`) → BullMQ `reports` job → renderer worker (Playwright Chromium, role `renderer`) issues a **render token** (Redis, 60 s, single use, bound to user scope + dashboard), opens `/print/dashboard?rt=…` (print layout, branded header/footer, date range, waits for `data-ready`), saves PDF to storage, notifies like exports.
- [ ] Tests: render token single-use and expiring (**Review Focus 5**); token for dashboard X cannot load Y; worker produces a PDF (integration with Chromium inside the renderer image in the compose smoke; unit-level with the token flow).
- [ ] Commit `feat(reports): server-side dashboard PDF reports`.

### Task 15: Overview dashboards on both portals

Wire the built-in overview to `/` for platform and customer users; configurable key columns per profile in the entity table; platform view adds a customer column and filter; KPI tiles live via status feed. Remove the sub-project-1 static overview.
- [ ] Tests: platform overview shows customer column, customer overview doesn't; KPI tile updates on a status event; click-through opens the device dashboard.
- [ ] Commit `feat(web): overview dashboards for platform and customer portals`.

### Task 16: End-to-end, docs, release v0.2.0

- E2E (`e2e/dashboards.spec.ts`): platform admin generates a Telecom RMS dashboard, edits it in the builder (adds a gauge), device assigned to acme; acme admin sees the dashboard with live updates within 2 s; customises it, then re-syncs after the template changes; exports History to XLSX (download parses); requests a PDF report and receives the notification with a working link; acme admin cannot open beta's device dashboard.
- Docs: `docs/dashboards.md` (templates, instances, builder), `docs/widgets.md` (SDK for custom widgets), update `operations.md` (renderer service, export retention).
- Smoke: renderer service healthy; one report renders.
- Bump `VERSION` to `0.2.0`, CHANGELOG, commit `chore(release): v0.2.0`, tag `v0.2.0` (local; the user pushes).
