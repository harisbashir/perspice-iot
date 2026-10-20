# Phase 2: Update windows and device veto

**Goal:** firmware rollouts only start installing inside a chosen time window (e.g. 02:00–05:00 site
time), and a device can say "not now" (generator running, technician on site, on a cellular link)
and be asked again later. Also introduces the `caps` attribute the later phases rely on.

**Ships as:** platform (next minor), then PerspiceClient minor. **Size:** S.

## Scope decisions

| Item | Decision |
|---|---|
| Window | Optional on a rollout: start and end time of day and a timezone (default: the customer's timezone, else UTC). The scheduler only *sends* updates inside the window; a device that started downloading may finish after it closes. Windows can cross midnight. |
| Timeouts | Time outside the window doesn't count towards a device's timeout. |
| Veto | The OTA message carries `"deferAllowed": true` (new platform). A device may answer progress `{"state":"deferred","retryAfterS":1800,"reason":"generator running"}`. The platform re-sends after `retryAfterS` (clamped 5 min–24 h). A device deferring for more than the job's `maxDeferH` (default 24) in total fails with "Deferred too long". Deferral time doesn't count towards the timeout. |
| `caps` | The library publishes a client attribute `caps`, a JSON array of features it supports, on every connect. This phase adds `"defer"`. The platform shows `caps` on the Credentials/Firmware tab. Later phases add their own entries. |
| Library API | `client.onOtaRequest(cb)` where `cb(const PerspiceOtaInfo&)` returns `PerspiceOta::accept()` or `PerspiceOta::defer(seconds, "reason")`. Without a callback the library accepts, as today. |

## Compatibility

- New platform + old library: `deferAllowed` is ignored; windows still work (they're platform-side).
- Old platform + new library: no `deferAllowed` in messages, so the library never defers; `caps` is
  just another client attribute.
- Migration: rollout columns `window jsonb null`, `max_defer_h int not null default 24`; job device
  columns `deferred_until timestamptz null`, `deferred_total_s int not null default 0`,
  `defer_reason text null`. New device state `deferred` (`OtaDeviceState` union in shared).

## Changes

- **Shared** (`packages/shared/src/fleet.ts`): window schema (`HH:MM`, timezone), `deferred`
  state, progress schema accepts `retryAfterS`, `reason`.
- **Server** (`apps/server/src/firmware/ota.rollout.ts`, `ota.service.ts`): `inWindow(now, window)`
  helper; sending gated by the window; deferred handling and timeout accounting; job page data shows
  "Waiting for the window (opens 02:00)" style status, shown in the job's own timezone.
- **Web**: Deploy dialog gains "Install only between" (two time fields, timezone select) and "Allow
  devices to postpone for up to N h"; job and device rows show *Deferred until 14:30 · generator
  running*.
- **Library** (`PerspiceClient`): parse `deferAllowed`; `onOtaRequest`; send `deferred`; publish
  `caps`; `ProductTemplate` shows a veto (defer while the output relay is on, as an example).
- **Docs:** `docs/fleet.md` (windows, deferral), `docs/device-protocol.md` (`deferred`, `caps`),
  `firmware/PerspiceClient/CLAUDE.md` (the callback, `caps`).

## Tasks

- [ ] 1. Shared: window schema and `inWindow()` with tests (midnight crossing, DST change in the zone).
- [ ] 2. Migration and rollout gating; timeout ignores outside-window time. Unit tests on
      `ota.rollout.ts` with a fake clock; integration test of a job across a window boundary.
- [ ] 3. Deferred state end to end on the platform: progress accepted, re-send after `retryAfterS`,
      cap and failure, timeout accounting. Integration tests (MQTT and HTTP device paths).
- [ ] 4. Web: Deploy dialog fields, job page and device rows. Unit tests; demo data; screenshots.
- [ ] 5. Release the platform part (release PR) before the library part merges.
- [ ] 6. Library: `caps`, `deferAllowed` parsing, `onOtaRequest`, `deferred` progress. Host test for
      the message parsing; CI compiles examples; `ProductTemplate` example of a veto.
- [ ] 7. Docs and CHANGELOG; tag the library release when asked.

## Bench checklist

- Deploy with a window that opens in 5 minutes: nothing is sent before it opens.
- Device vetoes ("generator running"): the job shows it deferred; after `retryAfterS` it is asked
  again and installs once the veto stops.
- An old-library device in the same rollout updates normally.

## Done when

A rollout with a 02:00–05:00 window installs nothing during the day, and a device that defers is
retried and finally updated or failed with a clear reason.
