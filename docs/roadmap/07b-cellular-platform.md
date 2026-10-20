# Phase 7b: Cellular on the platform (SIM info, data use)

**Goal:** make cellular devices easy to look after: which link each device is on, SIM details, signal,
and how much data it uses.

**Ships as:** platform minor. Uses the readings from 7a (and phase 3's Health tab). **Size:** S.

## Scope decisions

| Item | Decision |
|---|---|
| Device page | Health tab (phase 3) gains a Cellular card when `sys.iccid` or `sys.csq` exists: operator, ICCID (copy button), IMEI, signal (Signal strength widget, `csq` scale), data used today / this month (from `sys.cell_bytes`, which resets at boot: the platform sums positive differences per day). |
| Fleet | Device list column and filter "Link" (`ethernet`, `wifi`, `cellular`) from `sys.link` or the existing `net` attribute; a "Data use" export (device, ICCID, bytes per day) for checking against the operator's bill. |
| Alarms | Presets: "On cellular for more than 1 h" (state match on `sys.link` with duration), "Weak cellular signal" (`sys.csq` below 8 for 30 min), "Cellular data above N MB this month". |
| Labels | `SYSTEM_KEYS` (phase 3) gains the cellular keys. |

## Compatibility

Read-only use of telemetry and attributes the library already sends; nothing changes for devices
without cellular.

## Tasks

- [ ] 1. Shared: cellular `SYSTEM_KEYS`; data-use aggregation function (handles counter resets).
      Unit tests.
- [ ] 2. Server: data-use query (per device, per day/month) on top of the telemetry store; link filter
      in the device list API; export kind. Integration tests.
- [ ] 3. Web: Cellular card, Link column/filter, alarm presets, export. Demo data (one cellular
      site); screenshots.
- [ ] 4. Docs (`docs/fleet.md` Cellular section, help), CHANGELOG, platform release when asked.

## Done when

The fleet list shows which sites are on cellular, and a site's page shows its SIM, signal and data use
for the month.
