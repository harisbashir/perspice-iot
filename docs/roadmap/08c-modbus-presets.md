# Phase 8c: Modbus presets for common equipment

**Goal:** add a common controller or meter to a profile by choosing it from a list, instead of typing
register maps from a PDF.

**Ships as:** platform minor. Needs 8a. **Size:** S (plus the time to verify each register map).

## Scope decisions

| Item | Decision |
|---|---|
| Format | A preset is a slave entry from 8a's schema (points and optional writes) plus metadata (`vendor`, `model`, `source`: the document and version the registers came from). Stored as JSON files in `packages/shared/src/modbus-presets/`, so they're versioned with the code. |
| Use | Profile editor › Modbus › Add slave › From preset: pick, set the unit id and key prefix; points are copied into the profile (later edits don't change the preset). Import/export of single slaves as JSON for sharing custom maps. |
| Which presets | Chosen with the maintainer when this phase starts, from equipment actually installed. Candidates: a single-phase and a three-phase energy meter (e.g. Eastron SDM120 / SDM630), a genset controller (e.g. Deep Sea Electronics DSE7320 via its GenComm map), a telecom rectifier controller, a battery monitor. |
| Accuracy | **Every preset must be checked against the vendor's current register document and on real equipment before it ships.** The `source` field records the document; the PR lists what was verified on the bench. Registers that couldn't be verified are left out rather than guessed. |

## Compatibility

Platform data only; nothing changes for devices.

## Tasks

- [ ] 1. Preset schema (8a's slave schema + metadata) and a test that every preset file validates.
- [ ] 2. The chosen presets, each with its source document noted.
- [ ] 3. Web: "From preset" flow and single-slave import/export. Screenshots.
- [ ] 4. Docs (`docs/modbus.md` presets list, how to contribute a preset), CHANGELOG, platform release
      when asked.

## Bench checklist

- Each preset: values read on the device match the equipment's own display or software.

## Done when

Adding a supported meter or genset controller to a profile takes a minute and gives correct values.
