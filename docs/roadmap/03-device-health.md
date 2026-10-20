# Phase 3: Device health readings

**Goal:** every device running the new library reports a standard set of health readings, and the
device page has a Health tab that makes problems obvious: restarts, low memory, weak signal, link
changes. No profile editing needed.

**Ships as:** PerspiceClient minor first (it's useful on its own: the readings are ordinary
telemetry), then the platform minor with the Health tab. **Size:** S–M.

## Readings (reserved prefix `sys.`)

Keys match the protocol's `^[A-Za-z0-9_.-]{1,64}$`. Telemetry every `healthIntervalS` (default 300,
900 on cellular once 07a exists); attributes on connect.

| Key | Kind | Meaning |
|---|---|---|
| `sys.uptime` | telemetry, s | seconds since boot |
| `sys.heap` | telemetry, bytes | free heap now |
| `sys.heap_min` | telemetry, bytes | lowest free heap since boot (leaks show as a falling floor) |
| `sys.rssi` | telemetry, dBm | Wi-Fi signal (when on Wi-Fi) |
| `sys.link` | telemetry, string | `ethernet`, `wifi` (later `cellular`) |
| `sys.reconnects` | telemetry, count | broker reconnects since boot |
| `sys.buffered` | telemetry, count | readings waiting in the offline buffer |
| `sys.boot` | telemetry, 1 | sent once per boot, so restarts can be counted from history |
| `sys.reset` | attribute | reset reason of this boot (`poweron`, `panic`, `brownout`, `wdt`, `sw`…) |
| `sys.chip`, `sys.idf`, `sys.flash` | attributes | chip model and revision, core/IDF version, flash size |

`caps` gains `"health"`.

## Scope decisions

| Item | Decision |
|---|---|
| Opt-in | `client.enableHealth(intervalS)`; off by default so data volume doesn't change for existing products. `ProductTemplate` turns it on. |
| Labels and units | A built-in list `SYSTEM_KEYS` in `packages/shared` gives labels, units and decimals for `sys.*`. The web app merges it into a profile's keys wherever keys are labelled (widgets, tables, exports), so `sys.heap` reads "Free memory (KB)". Profiles don't need to declare them. |
| Health tab | Shown when the device has any `sys.*` data. Cards: uptime, restarts in the last 7 days (count of `sys.boot`) with the last reset reason, memory now and lowest (a sparkline of `sys.heap_min`), link and signal (the Signal strength widget), reconnects per day, offline buffer. Each card goes amber or red at sensible built-in thresholds (e.g. ≥ 3 restarts in 24 h, `sys.heap_min` under 20 KB). |
| Fleet | A "Health" filter in the device list: devices that restarted ≥ 3 times in 24 h, or have low memory. Alarm rule presets for the same conditions (they're ordinary threshold/rate rules on `sys.*` keys). |
| Retention | Ordinary telemetry; follows the profile's retention. |

## Compatibility

- Ingest already stores keys a profile doesn't declare (no `telemetrySchema` check in
  `apps/server/src/ingest`; verify before relying on it). So the library part works on v1.1.0.
- New platform + old library: no `sys.*` data, no Health tab; the Firmware tab says health needs
  PerspiceClient ≥ the version of this phase.

## Tasks

- [ ] 1. Library: `enableHealth()`, the readings above (`esp_reset_reason()`, `ESP.getFreeHeap()`,
      `ESP.getMinFreeHeap()`, `WiFi.RSSI()`, link from `PerspiceNetwork`), `caps`. Host test for the
      reset-reason mapping; CI compile; flash cost noted in the PR.
- [ ] 2. Release the library part (when asked).
- [ ] 3. Shared: `SYSTEM_KEYS`, and `profileKeys()` (or a sibling) that adds them. Unit tests.
- [ ] 4. Server: restart counting endpoint or reuse of the history API (prefer reuse); device list
      filter `health=restarts|memory`. Integration tests.
- [ ] 5. Web: Health tab, device list filter, alarm presets in the rule form. Demo data (one healthy
      site, one restarting); screenshots at phone and desktop width.
- [ ] 6. Docs (`docs/fleet.md` Health section, help article), CHANGELOG, platform release PR.

## Bench checklist

- A device with health on shows all readings within one interval; `sys.reset` says `poweron` after a
  power cycle and `sw` after a remote `restart` command.
- A forced panic (test sketch) shows `panic` and counts as a restart.

## Done when

Opening a device shows at a glance whether it is restarting, leaking memory or on a weak link, without
anyone adding keys to its profile.
