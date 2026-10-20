# Phase 5: Wi-Fi setup portal (library)

**Goal:** a technician sets a device's Wi-Fi from a phone, without the HMI or a laptop: the device
opens its own Wi-Fi network with a small setup page.

**Ships as:** PerspiceClient minor only. **Size:** M.

## Scope decisions

| Item | Decision |
|---|---|
| When it starts | (a) No Wi-Fi configured and no Ethernet link within 60 s of boot; (b) the product calls `portal.start()` (a button held 5 s, an HMI menu item); (c) the built-in command `perspice.setup` (for a device that is online over Ethernet). Stops after 10 minutes, once Wi-Fi connects, or on `portal.stop()`. |
| Network | SoftAP `Perspice-XXXX` (last 4 hex of the MAC, or a product prefix), WPA2 with a password: the product supplies it (printed on the label; the provisioning claim code works well), never open by default. Runs alongside Ethernet; Wi-Fi station and AP together (`WIFI_AP_STA`) so it can scan and test. |
| Page | One small HTML page (inline in flash, ~10 KB, styled like the web app's sign-in page): device name/serial and current link status, a list of scanned networks with signal bars, password field, "Connect" (tests the connection and shows the result), and optionally the network priority (Ethernet first / Wi-Fi first). Captive-portal DNS so phones open the page automatically. |
| Saving | Through `PerspiceNetwork::setWifi()` / `setPriority()`, which are already safe from any task and persist in NVS. |
| Out of scope | BLE provisioning, setting the API host or provisioning key (those are factory settings), firmware upload through the page. |
| Flash | `WebServer` + `DNSServer` cost roughly 60–80 KB (measure). The portal lives in its own header `PerspiceSetupPortal.h` so sketches that don't include it pay nothing. Document that Ethernet + portal sketches need the `min_spiffs` partition (1.9 MB app). |

## Compatibility

Library only, opt-in header. No protocol change except the built-in command `perspice.setup` and
`caps` entry `"portal"` (the platform shows a "Wi-Fi setup" action for devices with it once the
platform knows the cap; until then the command can be sent as a raw command).

## Tasks

- [ ] 1. `PerspiceSetupPortal` class: start/stop, AP + captive DNS, scan, connect test, save via
      `PerspiceNetwork`, timeout. Runs from `loop()` (no extra task), non-blocking.
- [ ] 2. The page (HTML/CSS/JS inline, no external assets; works on iOS and Android captive sheets).
      Keep it under 12 KB.
- [ ] 3. Host-testable pieces: form parsing and validation (SSID ≤ 32, password 8–63 or empty for
      open networks), JSON for the scan list.
- [ ] 4. Example `WifiSetup` (button on GPIO 0 starts the portal); `ProductTemplate` gains an HMI
      hook; CI compiles both for ESP32 and ESP32-S3 with the right partition scheme.
- [ ] 5. Optional platform touch (can be a later small PR): a "Wi-Fi setup" button on the device page
      for devices whose `caps` include `"portal"`.
- [ ] 6. Docs: `PerspiceClient/CLAUDE.md` (API, partition note, security), README, CHANGELOG; library
      release when asked.

## Bench checklist

- Fresh device with no Wi-Fi and no Ethernet: AP appears within ~60 s; an iPhone and an Android phone
  both open the page automatically; choosing a network connects and the device reaches the broker.
- Wrong password: the page says so and keeps the old settings.
- Device on Ethernet: `perspice.setup` command opens the portal without dropping the Ethernet link.

## Done when

A technician with only a phone can put a new device on Wi-Fi in under two minutes.
