Get data out of the platform as files: straight away, as a PDF of a dashboard, or emailed on a schedule.

## Exports

Tables and charts on dashboards, a device's **History**, the device list, alarm lists, trips and the audit log have an **export** button: **CSV**, **Excel (XLSX)** or **PDF**.

- Up to 50,000 rows download straight away.
- Larger exports are prepared in the background. You get a notification and an email when the file is ready, and **My exports** lists them.
- PDF exports are limited to 10,000 rows.
- Files are kept for **24 hours**, and only you can download your own exports. After that, run the export again.

## PDF reports of dashboards

**PDF report** on a dashboard (or the overview) creates a PDF of the current view and time window, with your logo and colours. It is prepared in the background and arrives like a large export.

## Scheduled reports

**Scheduled reports → New schedule** emails a report regularly to people in your organisation:

- **Report**: *The overview dashboard (PDF)*, *A device dashboard (PDF)*, or a *Device telemetry export* of chosen values (CSV, Excel or PDF).
- **Repeat**: **Daily**, **Weekly** (choose the day) or **Monthly** (a **day of the month**, 1–28 so every month has it), at a time in a chosen **timezone**.
- **Period**: what each report covers, e.g. the **last 7 days** up to the run time.
- **Send to**: the people who receive it.

The email links to the file, and the link works for **7 days**. The list shows each schedule's **last run** and **next run**.

A schedule runs with its owner's access at the time it runs. If the owner's account is disabled, or they can no longer see the device, the run is skipped and the reason is shown.

:::platform
## For platform users

Exports up to 50,000 rows are generated in the request; larger ones run on the `scheduler`. Dashboard PDFs are rendered by the `renderer` service (headless Chromium) through Caddy's internal listener with a single-use render token. A report stuck in *Queued* usually means the renderer isn't running: `perspice status`, `perspice logs renderer`. Files live under `exports/` in storage and are deleted 24 hours after they finish; download links are signed and valid for 5 minutes. Permissions: `export.data` (exports and reports; audit exports also need `audit.read`) and `report.schedule`.
:::
