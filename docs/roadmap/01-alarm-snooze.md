# Phase 1: Alarm snooze for site visits

**Goal:** a technician visiting a site (or someone planning the visit) can snooze a device's
alarms for a while: alarms are still raised and recorded, but nobody is notified until the snooze
ends. Removes the daily noise of door, mains and generator alarms during planned work.

**Ships as:** platform only (next minor). **Size:** S.

**Naming:** "Snooze" in the UI. Not "maintenance": that word already means service reminders
(`apps/server/src/alarms/maintenance.service.ts`, rule type `maintenance_due`, the device's
Maintenance tab).

## Scope decisions

| Item | Decision |
|---|---|
| What is snoozed | A device, or an asset (all devices in its subtree, resolved when alarms raise, so devices added later are covered). |
| Duration | 30 min, 1 h, 4 h, until a time, or a scheduled window (planned visit, start in the future). Max 7 days. |
| Effect | Alarms raise, update and clear as usual and are stored with `snoozed = true`. No notifications of any kind (email, push, in-app, webhooks). Alarm lists show them with a "Snoozed" chip; KPI counts still include them. |
| When it ends | Alarms still **active** when the snooze ends are notified then, once, with "still active after the snooze" in the message. Alarms that cleared during the snooze aren't notified. |
| From the device | Optional: a profile setting names a boolean key (e.g. `visit_key`, a technician's key switch). While it is true, the device counts as snoozed. Same effect, reason "On-site switch". |
| Who | Users with `alarm.ack` for devices in their scope (no new permission, so no role migration). Audited: `alarm.snooze`, `alarm.snooze.cancel`. |
| Webhooks | Payload gains `"snoozed": true/false` (additive). |

## Compatibility

Platform only. Additive migration (one table, one column with a default). No device changes.

## Changes

- **Database:** `alarm_snooze (id, device_id null, asset_id null, customer_id, starts_at, ends_at,
  reason text, created_by, created_at, cancelled_at null)` with a check that exactly one of
  device/asset is set; index on `(device_id, ends_at)` and `(asset_id, ends_at)`. `alarm.snoozed
  boolean not null default false`. Profile: `snooze_key text null`.
- **Shared:** `SnoozeInputSchema`, `SnoozeDto`; `AlarmDto.snoozed`.
- **Server:** `alarms/snooze.service.ts` (create, cancel, list, `isSnoozed(deviceId, at)` with a short
  cache, asset subtree via the assets service); the raise path in `alarm-store.ts` sets `snoozed`;
  the notification dispatch skips snoozed alarms; a scheduler job (every minute) finds snoozes that
  ended and notifies their still-active alarms. API: `POST /devices/:id/snooze`,
  `POST /assets/:id/snooze`, `DELETE /snoozes/:id`, `GET /snoozes?deviceId|assetId|active`.
- **Web:** device page header shows "Alarms snoozed until 14:30 · Cancel"; a Snooze button (sheet on
  phones) with the presets and an optional reason; the same on asset pages; bulk action in the
  device list; "Snoozed" chip in alarm lists and the alarm table widget; profile editor field for
  the snooze key.
- **Docs:** `docs/alarms.md` section, help article `alarms.md`.

## Tasks

- [ ] 1. Shared schemas and DTOs (zod: duration bounds, start < end, max 7 days). Unit tests.
- [ ] 2. Migration and Drizzle schema. Integration test: migrate up on a copy of a v1.1.0 database.
- [ ] 3. Snooze service and API, tenancy checks (a customer can't snooze another customer's device or
      asset: 404), audit entries. Integration tests.
- [ ] 4. Raise path and notifications: snoozed alarms recorded, not notified (email, push, in-app,
      webhook); device-key snooze from the profile's `snooze_key`. Integration tests for each
      channel and for the key.
- [ ] 5. End-of-snooze job: notify still-active alarms once; nothing for cleared ones; idempotent
      across scheduler restarts (store `notified_at` on the snooze). Integration test.
- [ ] 6. Web: device header line and Snooze sheet, asset page, bulk action, chips, profile field.
      Unit tests with MSW; demo data (one snoozed site) and screenshots at phone and desktop width.
- [ ] 7. Docs, help, CHANGELOG. e2e: snooze a device, raise an alarm over MQTT, see it listed as
      snoozed and no notification in Mailpit; cancel; next alarm notifies.

## Done when

A snoozed site's door alarm shows in the list as snoozed, nobody gets an email or push, and an alarm
still open when the snooze ends arrives once with the "still active" note.
