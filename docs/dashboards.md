# Dashboards

Dashboards are designed once by the platform and shown to every customer that owns a matching
device. Customers can tailor their copy without affecting anyone else.

## Templates and instances

- A **template** belongs to a device profile (`kind: device`) or is the **overview** (`kind:
  overview`). Platform users with `dashboard.edit` create and edit templates under
  **Dashboards**.
- Each profile has at most one **default** template ("Use for all … devices"). Every device of
  that profile opens on it, whichever customer owns the device.
- An **instance** is one customer's copy of a template (the platform has its own). It is created
  automatically the first time it is needed. Until a customer changes it, it simply shows the
  template, so template edits appear for everyone at once.
- **Customise** (customer admins, `dashboard.customize`) stores an override for that customer
  only. The override records the template version it was copied from. When the template changes
  afterwards, the device page says so and offers **Re-sync with template**, which discards the
  customisation.

Every template write increases its version. Definitions are validated on every save, import and
customisation. Widget types the running version doesn't know are kept and shown as "Unknown
widget", so newer templates still load.

### Getting started

- **Generate from profile** builds a dashboard from a profile's telemetry keys and commands: value
  cards and LEDs, a history chart, a latest-values table and command buttons. It becomes the
  profile's default.
- **Clone…** copies a template onto another profile. When the key names differ, map them in the
  dialog (unmapped keys are listed).
- **Export JSON / Import** move templates between installations (`perspice-dashboard` v1 files).

## The builder

A dashboard has one or more **views** (tabs), each a 12-column grid of up to 60 widgets.

- **Add widget** opens the widget library. Drag widgets by their handle and resize them from
  the corner; click a widget to edit its title, data source and options in the side panel.
- **Data sources**: the device the dashboard is open for (*current device*), one chosen device,
  all devices of a profile (optionally filtered by status, tags or name), or a device list with
  chosen columns (built-in columns or telemetry keys).
- **Map** widgets show devices with a location (markers coloured by status, clustered when there
  are many) or one device's route with playback; see [location.md](location.md).
- The **time window** (relative, e.g. last 24 h, or absolute) and refresh interval are dashboard
  settings. Viewers can change the window for their session with the picker.
- In the template editor, **Preview with** shows the dashboard with live data from one of the
  profile's devices.

## Viewing

- Device pages open on the **Dashboard** tab when the profile has a dashboard.
- Both portals open on the **Overview**: KPI tiles (device counts by status, messages in the last
  24 hours) and the device table. Platform users also see a customer column and a customer filter.
- Values, statuses and charts update live over the WebSocket connection (up to 500 devices per
  dashboard). KPI tiles follow status changes across the whole fleet.
- Every widget reads its data through the viewer's own scope. A customer can never see another
  customer's devices, even with a hand-edited definition.

## Exports and reports

- Tables and charts have an **export** button (CSV, Excel, PDF). The device **History** tab, the
  devices list and the audit log can be exported too. Exports need `export.data` (audit exports
  also need `audit.read`).
- Up to 50,000 rows download immediately. Larger exports are prepared in the background: you
  get a notification and an email, and **My exports** (`/exports`) lists them. Files are kept for
  24 hours and only the person who asked for them can download them. PDF exports are limited to
  10,000 rows.
- **PDF report** on a dashboard renders the current view and time window as a branded PDF, in
  the background, and is delivered the same way.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET/POST` | `/api/dashboard-templates` | list / create templates |
| `GET/PATCH/DELETE` | `/api/dashboard-templates/:id` | read / update / delete |
| `POST` | `/api/dashboard-templates/:id/clone` | clone with key mapping |
| `GET` | `/api/dashboard-templates/:id/export` | export envelope |
| `POST` | `/api/dashboard-templates/import` | import an envelope |
| `POST` | `/api/device-profiles/:id/generate-dashboard` | generate a default dashboard |
| `PUT` | `/api/device-profiles/:id/default-dashboard` | set a profile's default |
| `GET` | `/api/dashboards/device/:deviceId` | a device's dashboard as the viewer sees it |
| `GET` | `/api/dashboards/overview` | the viewer's overview |
| `PUT/DELETE` | `/api/dashboard-instances/:id/override` | customise / re-sync |
| `POST` | `/api/dashboards/data` | data for many widgets in one request |
| `POST` | `/api/exports` | export (200 with the file, or 202 with a job) |
| `GET` | `/api/exports`, `/api/exports/:id` | your export jobs, with download links |
| `POST` | `/api/reports/dashboard` | queue a dashboard PDF report |
