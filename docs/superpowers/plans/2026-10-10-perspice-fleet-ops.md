# Perspice IoT — Sub-project 5b: Fleet Operations Implementation Plan

> **For agentic workers:** execute task by task. Each task is test-first (write the failing test, see it fail, implement, see it pass) and ends with one conventional commit. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v0.6.0: firmware management and OTA updates (upload, staged rollout with progress and automatic halt, ESP32 support in the firmware library), claim-code provisioning (customers add devices themselves), CSV device import with one-time credential download, and bulk operations from the device list (assign, group, tags, command, delete).

**Architecture:** builds on v0.5.0. New server modules `firmware` (images in storage, OTA jobs and their per-device rows, rollout engine in the scheduler role, progress from `ota/progress` and the reported firmware version) and `provisioning` (claim codes, CSV import). Bulk operations live in `devices`. The firmware library gains an OTA handler (HTTPS download, SHA-256 check, `Update`, progress, rollback-safe boot).

**Tech additions:** none on the server (CSV parsed with a small RFC 4180 parser in `packages/shared`). Firmware: ESP32 `Update`, `HTTPClient`, `mbedtls` SHA-256.

**Spec:** §4 (`firmware`, `ota_job`), §5.1 (`ota`, `ota/progress` topics), §5.6 (library OTA, `OtaUpdate` example), §11 (claim codes, CSV bulk provisioning, bulk operations), §13 row 5.

## Scope decisions

| Item | Decision |
|---|---|
| Firmware images | Uploaded by platform users (`firmware.manage`) per profile, raw body ≤ 16 MB, stored at `firmware/<id>.bin`, SHA-256 computed on upload, version unique per profile (semver-ish string). Deleting is refused while a job uses it. |
| Download | Devices fetch the image over HTTPS from a signed link (`/api/files/firmware/…`, valid 24 h, or the S3 link when direct downloads are on); the message carries the SHA-256 and size. |
| OTA jobs | Target: chosen devices, or all devices of the firmware's profile (optionally filtered by customer and tags), excluding those already on the version. Rollout: `batchSize` devices at a time (default 10), the next batch once the current one finishes; **halt** automatically when more than `maxFailurePct` (default 20%) of finished devices failed. Per device: `pending → sent → downloading → verifying → applied` or `failed`/`skipped`; `applied` requires the device to report the new `fw` attribute; a device that doesn't finish within `timeoutMin` (default 30) fails. Offline devices get the message when they come back online, until the job is cancelled. |
| Who can deploy | Platform users with `firmware.manage`. Customers see their devices' OTA status (read-only) on the device page. |
| Claim codes | Created with a device (optional) or by import: 12 characters, unambiguous alphabet (no 0/O/1/I), shown once, stored hashed. A customer admin (`device.claim`) claims an **unassigned** device with its code: the device joins their customer (optionally a group, renamed). Codes are single-use; claiming is rate-limited (10/min per user) and audited. Unclaimed devices stay in the platform pool. |
| CSV import | Platform users (`device.write`, platform scope): columns `name, profile, customer (slug, optional), group, tags (semicolon-separated), lat, lng, claim (yes/no)`; a dry run validates every row first (all-or-nothing); the result offers a CSV with each device's id, token and claim code once (never stored in clear). Max 5,000 rows. |
| Bulk operations | `POST /devices/bulk` with up to 500 device ids and one action: `assign` (customer, platform only), `group`, `tags` (add/remove), `command` (same profile, `device.command`), `delete`. Each id is checked against the caller's scope; the response lists per-device results. Audited as one entry with the ids. |

## Global Constraints

- Firmware and OTA management are platform-only; customers can't upload, deploy or read other customers' OTA rows (Review Focus 1).
- A device only ever gets an OTA message for its own profile's firmware, with a signed, expiring link and the SHA-256 the device must check before applying (Review Focus 2).
- Claim codes are unguessable (60 bits), hashed, single-use, rate-limited, and only claim unassigned devices (Review Focus 3).
- Bulk operations never act on a device outside the caller's scope, even when its id is listed (Review Focus 4).

## Review Focus

1. **OTA tenancy** — a customer reading jobs or firmware, or deploying. Expect 403/404. Tests in Tasks 2, 3.
2. **Image integrity** — corrupted download, wrong version reported, device stuck. Expect: the device refuses a bad SHA-256 and reports `failed`; the job counts it failed; timeouts fail stuck devices; the halt threshold stops a bad rollout. Tests in Tasks 3, 4.
3. **Claim code abuse** — guessing, reuse, claiming an assigned device, another customer's device. Expect: rate limit, single use, 404 without detail. Tests in Task 6.
4. **Bulk scope** — mixed in-scope and foreign ids. Expect: foreign ids reported as not found and untouched. Tests in Task 5.

---

## File Structure (new or substantially changed)

```
packages/shared/src/fleet.ts              firmware, OTA, claim, import, bulk DTOs and schemas; CSV parser
apps/server/src/firmware/                 firmware.service.ts, ota.service.ts (jobs, rollout, progress), ota.rollout.ts (pure),
                                          firmware.controller.ts, ota.controller.ts
apps/server/src/provisioning/             claim.service.ts, import.service.ts, provisioning.controller.ts
apps/server/src/devices/bulk.service.ts
apps/server/src/db/schema/fleet.ts        firmware, ota_job, ota_job_device, device_claim
firmware/PerspiceClient/src/PerspiceOta.* OTA handler (ESP32); examples/OtaUpdate
apps/web/src/pages/firmware/              firmware list/upload, OTA job pages
apps/web/src/pages/devices/               selection + bulk action bar, import dialog, claim dialog, device OTA panel
docs/fleet.md
```

---

## Task 1: Shared contracts and CSV parser
- [ ] `fleet.ts`: schemas for firmware upload metadata, OTA job input (target, batchSize, maxFailurePct, timeoutMin), OTA progress message, claim, import row, bulk request; DTOs; `parseCsv` (quotes, escaped quotes, CRLF, BOM) and `toCsv`.
- [ ] Unit tests; commit `feat(shared): fleet operation contracts`.

## Task 2: Firmware images
- [ ] Table `firmware`; upload (raw body, `?profileId&version&notes`), list per profile, delete (refused while used), download link; permission `firmware.manage` (platform admin).
- [ ] Tests: upload computes SHA-256 and size, duplicate version 409, customer 403, delete in use 409.
- [ ] Commit `feat(firmware): firmware images`.

## Task 3: OTA jobs and rollout
- [ ] Tables `ota_job`, `ota_job_device`; pure rollout planner (`ota.rollout.ts`); service: create (resolve targets), dispatch next batch (scheduler tick 15 s and on progress), MQTT `ota` message with signed URL, progress from `ota/progress`, `applied` on `fw` attribute = version, timeouts, halt, cancel, resend on reconnect; HTTP devices get it from `GET /api/v1/device/ota`.
- [ ] Unit tests for the planner; integration: a rollout across two batches with devices acking over MQTT, a failure-rate halt, a timeout, offline device served on reconnect, cancel, customer can't see jobs.
- [ ] Commit `feat(firmware): OTA jobs with staged rollout`.

## Task 4: Firmware library OTA
- [ ] `PerspiceClient` handles `ota` messages on ESP32: HTTPS download with `HTTPClient` + `Update`, SHA-256 verify before `Update.end`, progress every 10%, `applied` reported after reboot by the new `fw` attribute; rollback-safe (mark valid after a successful reconnect). `OtaUpdate` example; compiled in CI.
- [ ] Commit `feat(firmware): OTA in the firmware library`.

## Task 5: Bulk operations
- [ ] `POST /devices/bulk`; per-device results; audit; scope checks; command to devices of one profile.
- [ ] Commit `feat(devices): bulk operations`.

## Task 6: Claim codes
- [ ] Table `device_claim` (hash, device, created, claimed_at/by); generate on create (`withClaimCode`) or import; `POST /devices/claim`; permission `device.claim` (customer admin); rate limit.
- [ ] Commit `feat(provisioning): claim codes`.

## Task 7: CSV import
- [ ] `POST /devices/import?dryRun=` (text/csv); validation report per row; creation in one transaction; credentials CSV in the response (once).
- [ ] Commit `feat(provisioning): CSV device import`.

## Task 8: Web
- [ ] Firmware page (upload, versions per profile, deploy dialog), OTA job page (progress bar, per-device table, halt reason, cancel), device page OTA status; device list selection with a bulk action bar; import dialog (dry run, errors per row, credentials download); "Add device with a claim code" for customer admins.
- [ ] Web tests; commit `feat(web): firmware, OTA, bulk operations, import and claiming`.

## Task 9: End-to-end, docs, release v0.6.0
- [ ] E2E (`e2e/fleet.spec.ts`): import two devices with claim codes, a customer claims one, the platform uploads firmware and deploys it, a simulated device downloads, verifies and reports progress to applied; bulk-tag devices.
- [ ] Simulator: `--ota` (download, check SHA-256, report progress, reboot with the new version).
- [ ] Docs `docs/fleet.md`; update `device-protocol.md`, `firmware.md`.
- [ ] `VERSION` 0.6.0, CHANGELOG, tag `v0.6.0` (local; the user pushes).
