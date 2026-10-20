# Phase 8b: Modbus polling in the library

**Goal:** an ESP32 with an RS-485 transceiver downloads its profile's Modbus map (8a), polls the
equipment, and publishes the values as telemetry. It also carries out Modbus write commands, with no
product code per controller.

**Ships as:** PerspiceClient minor. Needs 8a on the platform. **Size:** M.

## Scope decisions

| Item | Decision |
|---|---|
| Master | Own minimal Modbus RTU master (`PerspiceModbus.h`): functions 1–6 and 16, CRC-16, inter-frame timing (3.5 character times), response timeouts, retries (1 by default). No external library, so it can be host-tested and its memory use is known. |
| Hardware | A UART (`Serial1`/`Serial2`) and an RS-485 transceiver; `dePin` for half-duplex direction (MAX485-style), or none for auto-direction modules. Pins and UART in `PerspiceModbusConfig`; the line settings come from the map. |
| Map | Fetched from `GET /api/v1/device/modbus` when `perspice.modbusRev` changes (and at boot if the stored one is missing). Stored in NVS or a small LittleFS file (choose by size; maps are a few KB). Polling continues with the stored map while offline. |
| Polling | A FreeRTOS task (the bus is slow and blocking); contiguous points of the same slave and function are grouped into one request (same grouping as 8a's shared function, checked against its test vectors). Values are converted (`scale`, `offset`, word order) and handed to the comms task through a queue, which sends them with `sendTelemetry` in batches (per slave per poll). |
| Status | Per slave: `mb.<unit>.ok` (1/0) and `mb.<unit>.errors` (count of timeouts and CRC errors since boot) as telemetry, so a dead RS-485 line is visible and can raise an alarm. |
| Writes | The library registers the profile's Modbus-bound commands itself; a command writes the register(s) and acknowledges with success or the Modbus exception code. |
| caps | `"modbus"`. |

## Compatibility

Opt-in header and `client.useModbus(modbus)`. Without it nothing changes. An old platform without the
endpoint: the library logs it once and stays idle.

## Tasks

- [ ] 1. Host-tested core: frame building/parsing, CRC, exception handling, type conversion (all types
      and word orders), grouping (against 8a's vectors). Added to `firmware/test` and CI.
- [ ] 2. UART/RS-485 transport with DE control and timing; polling task; queue to the comms task.
- [ ] 3. Map fetch/store/reload on `perspice.modbusRev`; status telemetry; write commands.
- [ ] 4. Example `ModbusMeter` (ESP32 + MAX485 + an energy meter); `ProductTemplate` gains optional
      Modbus. CI compiles for ESP32 and ESP32-S3; record flash use.
- [ ] 5. Docs: `PerspiceClient/CLAUDE.md` (wiring, termination and biasing, timing), `docs/modbus.md`
      device section, CHANGELOG; library release when asked.

## Bench checklist

- One energy meter: values match the meter's display; `mb.1.ok` drops to 0 when the A/B wires are
  disconnected and recovers.
- Two slaves on one bus with different poll intervals.
- Map edited on the platform: the device picks up the new revision within a minute, without a restart.
- A write command (relay or genset start on a test bench) acknowledges with success; a write to an
  invalid register returns the Modbus exception.

## Done when

A device polls real Modbus equipment from a map edited on the platform, and its values show up on
dashboards like any other telemetry.
