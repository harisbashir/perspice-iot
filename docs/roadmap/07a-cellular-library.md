# Phase 7a: Cellular link with SIM800 (library)

**Goal:** a third connection for remote sites: a SIM800 GSM/GPRS modem, used when Ethernet and Wi-Fi are
down (or as the only link), through the same `PerspiceNetwork` failover the device already has.

**Ships as:** PerspiceClient minor (ESP32 / ESP32-S3 only). **Size:** M.

## Read first: SIM800 caveats

- **2G only (GSM/GPRS).** Real throughput is roughly 20–40 kbit/s up and down. Fine for telemetry and
  commands; a 1.3 MB app update takes several minutes, and a 10 MB Nextion file would take an hour and
  cost data. Large downloads should be deferred while on cellular (phase 2's veto; policy below).
- **2G networks are being switched off** in several countries. Check with the operators where the
  devices will be installed. The same code path supports 4G modules that the ESP32's modem driver knows
  (SIM7600, SIM7070/SIM7000, BG96, and generic AT modems such as the A7670), so a product can move to
  4G with a different board and one setting.
- **Power:** the SIM800 draws up to 2 A in transmit bursts; it needs its own 3.4–4.4 V supply with a
  large capacitor (≥ 1000 µF close to the module). Brownouts look like random disconnects.
- **TLS:** done by the ESP32 (mbedTLS over lwIP), not by the modem, so the platform's normal TLS and
  certificate pinning work unchanged.

## Approach

The Arduino-ESP32 core 3.3.x ships a `PPP` library built on ESP-IDF's `esp_modem`, with a
`PPP_MODEM_SIM800` model (confirmed in core 3.3.12's `libraries/PPP/src/PPP.h`). PPP gives the modem
link an lwIP network interface like Wi-Fi and Ethernet, so `NetworkClient`/`NetworkClientSecure`, DNS,
the MQTT client, OTA and provisioning all work over it without special cases. `PerspiceNetwork` already
switches the default interface and per-interface DNS (see `firmware/PerspiceClient/CLAUDE.md`), and
cellular becomes a third link in that scheme.

TinyGSM (the usual Arduino alternative) is not used: its TCP client sits outside lwIP, so TLS,
`Network.h` and the existing failover wouldn't apply.

## Scope decisions

| Item | Decision |
|---|---|
| Config | `PerspiceNetworkConfig` gains `cellular` (bool), `cellModel` (`PPP_MODEM_SIM800` default), UART pins (`cellTx`, `cellRx`, optional `cellRts`/`cellCts`), `cellPwrKey`, `cellReset` (optional), `cellApn`, `cellPin` (SIM PIN, optional), `cellUser`/`cellPass` (APN credentials). APN can be changed at run time and kept in NVS like Wi-Fi (`setCellular(apn, user, pass)`, safe from any task). |
| Priority | The priority becomes an ordered list of links. New values extend `PerspicePriority` (e.g. `EthernetWiFiCellular`, `WiFiEthernetCellular`, `CellularOnly`…); existing stored values keep their meaning, so devices upgraded in the field keep their behaviour. `setPriorityOrder({Ethernet, WiFi, Cellular})` for products that want any order. |
| Failover | Same rules as today: failures to reach the broker count against the link; cellular is brought up when the links ahead of it are down, and released (PPP down, modem to sleep) when a better link has been back for `failbackMs`. Bringing PPP up takes 10–60 s on 2G; the library does it in the background, and a link only counts as "up" when PPP has an IP. |
| Data saving | `client.onLinkChanged(cb)` and `network.link()` so products can change their own telemetry interval on cellular. The library itself: MQTT keepalive 120 s on cellular (60 s otherwise), health interval 900 s (phase 3), and OTA downloads larger than `cellMaxOtaBytes` (default 2 MB) are deferred while on cellular when the platform allows deferring (phase 2) and the product hasn't overridden it in `onOtaRequest`. |
| Modem info | Read once per connect over AT before PPP (or via `esp_modem` commands): IMEI, ICCID, operator, signal (CSQ). Reported as attributes `sys.imei`, `sys.iccid`, `sys.operator` and telemetry `sys.csq` (0–31, 99 = unknown) and `sys.cell_bytes` (bytes sent + received on the PPP interface since boot, from lwIP netif counters; verify they're available, else count at the MQTT layer). `caps` gains `"cellular"`. |
| SMS | Out of scope (an SMS fallback for alarms when data is down is a possible later idea). |

## Compatibility

- Opt-in config; sketches without `cellular` are unchanged. PPP code lives in its own header
  (`PerspiceCellular.h`, included by sketches that use it), so the flash cost is only paid when used
  (measure; esp_modem is not small).
- Platform: nothing required. `sys.*` cellular readings are ordinary telemetry/attributes; 7b displays
  them nicely.
- NVS: new keys in the existing `perspice_net` namespace; old values read as before.

## Tasks

- [ ] 1. Spike on the bench first: the core's `PPP_Basic` example with a SIM800 and the maintainer's
      SIM, to confirm `PPP_MODEM_SIM800` connects, how long attach takes, and whether hardware flow
      control is needed at 115200. Record results in this plan before building.
- [ ] 2. `PerspiceNetwork`: third link, ordered priorities (with the old enum values mapped), cellular
      bring-up/tear-down in the background, DNS capture for the PPP interface, failure counting, run-time
      APN settings in NVS.
- [ ] 3. Modem info and `sys.*` readings; `cellMaxOtaBytes` policy; MQTT keepalive per link.
- [ ] 4. Host tests: priority-order logic (extend the existing failover tests), NVS migration of old
      priority values, CSQ → bars mapping shared with the Signal strength widget's `csq` scale.
- [ ] 5. Example `CellularBackup` (W5500 + Wi-Fi + SIM800); `ProductTemplate` gains optional cellular;
      `DualNetwork` HMI menu adds cellular. CI compiles for ESP32 and ESP32-S3; record flash use.
- [ ] 6. Docs: `PerspiceClient/CLAUDE.md` (wiring, power, caveats, data saving), README, `docs/firmware.md`,
      CHANGELOG; library release when asked.

## Bench checklist

- SIM800 only: device provisions, connects over TLS, sends telemetry, receives a command.
- Ethernet + Wi-Fi + cellular: pull Ethernet → Wi-Fi; switch off the AP → cellular within ~1 min;
  restore Wi-Fi → back after `failbackMs`; PPP is torn down.
- OTA of a 1.3 MB app on cellular with the default policy: deferred; succeeds after Ethernet returns.
- Brownout test: weak supply → the library recovers the modem (power-key cycle) instead of hanging.

## Done when

A site whose Ethernet and Wi-Fi both fail stays online over SIM800, and returns to the better link by
itself.
