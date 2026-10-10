# Perspice IoT — Sub-project 5c: Calculated Telemetry, Energy and Generators Implementation Plan

> **For agentic workers:** execute task by task. Each task is test-first (write the failing test, see it fail, implement, see it pass) and ends with one conventional commit. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v0.7.0: calculated telemetry (per-profile derived keys from safe formulas, plus counter, runtime and fuel-use keys computed as data arrives), energy consumption and cost per day/week/month with flat or time-of-use tariffs, an energy summary widget, generator run hours, and maintenance reminders as the alarm rule type `maintenance_due` with a service log.

**Architecture:** builds on v0.6.0. A pure expression language in `packages/shared` (`expr.ts`: tokenizer, Pratt parser, checker, evaluator; no `eval`) used by the server and by the profile editor for validation and preview. Profiles gain `calculated` key definitions, evaluated in the ingest pipeline after normalising and before writing, so derived values are stored, aggregated, cached, alarmed on and charted like any other key. Stateful kinds (counter delta, runtime, fuel use) keep the previous value per device in Redis. Energy figures come from the hourly continuous aggregate (sum = avg × count), grouped in the customer's timezone, priced per hour with the customer's tariff. Maintenance runs in the scheduler.

**Tech additions:** none.

**Spec:** §11 (energy, generator/RMS, calculated telemetry), §6.1 (rule type `maintenance_due`), §7.3 (energy summary widget), §13 row 5.

## Scope decisions

| Item | Decision |
|---|---|
| Expression language | Numbers, booleans, key names (`[A-Za-z_][A-Za-z0-9_.]*`, or `["any-key"]`), `+ - * / % ^`, comparisons, `&& \|\| !`, `c ? a : b`, functions `abs min max round(x, d?) floor ceil sqrt pow log exp clamp(x, lo, hi)`. At most 500 characters and 200 nodes. A missing input, a non-number where one is needed, NaN or ±Infinity makes the result *missing* (nothing is written). |
| Calculated keys | Profile field `calculated` (≤ 20): `{ key, label, unit?, decimals?, kind, … }` with kinds: `formula` (`expr`); `counter_delta` (`source`, optional `maxDelta`): consumption since the previous reading of a cumulative counter, a reset (smaller value) counting the new value, a jump above `maxDelta` dropped to the debug log; `runtime` (`source`, `gapCapS` default 900): seconds the source was running (true or > 0) since the previous message, a gap longer than the cap counted as 0; `fuel_used` (`source`, `deadband` default 0.5): decreases of a level beyond the deadband, increases (refuels) ignored. Keys may not repeat a `telemetrySchema` key; formulas may use earlier calculated keys (evaluated in order; no cycles). A value the device sends under a calculated key's name is replaced. Applies to data received from now on (no recalculation of history). |
| Inputs | A formula sees the message's values at that timestamp over the device's latest values (so `v * i` works when `v` and `i` arrive in different messages). Stateful kinds only advance on newer timestamps; an older (out-of-order) reading is ignored for them. |
| Energy | `GET /devices/:id/energy?key=&from=&to=&period=hour\|day\|week\|month` → `[{ start, consumption, cost? }]` plus totals, from the 1-hour aggregate of a `counter_delta` (or any per-interval) key, periods in the customer's timezone (platform default for unassigned devices). Weeks start on Monday. |
| Tariffs | Per customer (`tariff.manage`, customer admins and platform), with a platform default: `currency`, `flat` (`rate` per unit) or `tou` (rates by weekday and whole hour, e.g. peak 17–21 on weekdays, a default rate otherwise). Cost per hourly bucket at that hour's rate. |
| Energy widget | `energy` data mode and an *Energy summary* widget: consumption and cost this period, change against the previous period, bars per day (or per hour for "today"). |
| Run hours | `runtime` keys sum to run hours (`GET /devices/:id/run-hours?key=&since=`). |
| Maintenance | Rule type `maintenance_due`: `{ runtimeKey?, everyHours?, everyDays?, warnPct? }` (at least one interval). A device's **service log** (`device_service`: when, run hours at the time, note, who; permission `device.service`) resets the counters. The scheduler checks hourly: hours run since the last service (or since the device was created) and days since; raises when an interval is reached (severity from the rule; with `warnPct`, a `warning` first at that share), clears when a service is logged. Device page **Maintenance** tab: run hours, since service, next due, log a service. |

## Global Constraints

- Formulas never execute code: the evaluator walks a checked AST with a fixed set of operators and functions, with size limits (Review Focus 1).
- Calculated keys can't break ingest: a bad or missing value skips that key for that message, never the message (Review Focus 2).
- Tariffs, energy and run hours are scoped like the device they belong to; customers manage only their own tariff (Review Focus 3).
- Load: evaluation is O(keys) per message with profile definitions cached (60 s) and stateful values in one Redis hash per device; the v0.4.0 load test must still pass (Review Focus 4).

## Review Focus

1. **Expression safety** — `constructor`, `__proto__`, deep nesting, huge numbers, long input. Expect: rejected at save time or evaluated to missing. Tests in Task 1.
2. **Ingest robustness** — missing inputs, strings, division by zero, counter resets, out-of-order data. Expect: those keys skipped or handled as specified, the rest stored. Tests in Tasks 2, 3.
3. **Tenancy** — another customer's energy, tariff, service log. Expect 404/403. Tests in Tasks 4, 6.
4. **Throughput** — calculated keys on every message. Expect: load test p95 within the criterion. Task 9.

---

## Task 1: Expression language (`packages/shared/src/expr.ts`)
- [ ] Tokenizer, Pratt parser, checker (known functions and arity, key names, size limits), evaluator; `inputsOf(ast)`; formatting of errors with position. Unit tests: precedence, ternary, functions, missing inputs, NaN/Infinity, limits, prototype names treated as ordinary keys.
- [ ] `CalculatedKeySchema` (kinds above) and `checkCalculated(defs, telemetrySchema)` (duplicates, cycles, unknown sources). Commit `feat(shared): expression language and calculated key definitions`.

## Task 2: Calculated telemetry in ingest
- [ ] Profile `calculated` column (migration), API and DTO; effective schema (telemetry + calculated keys) for key pickers.
- [ ] `CalculatedService`: cached definitions; evaluate per timestamp group (formula over latest + message values; stateful kinds via `calc:{deviceId}` hash, newer-only Lua); rows appended before write, cache, alarms and events. Integration tests: formula across messages, counter reset and `maxDelta`, runtime gap cap, fuel deadband and refuel, out-of-order, replaced device value, bad input leaves the rest. Commit `feat(telemetry): calculated keys`.

## Task 3: Profile editor support
- [ ] Web: profile editor section for calculated keys with live validation (shared checker) and a preview against the device's latest values. Web tests. Commit `feat(web): calculated keys in the profile editor`.

## Task 4: Energy and tariffs (server)
- [ ] `tariff` table (customer or platform default), `tariff.manage` permission, CRUD API; pure `priceHourly(buckets, tariff, tz)` and `groupPeriods(...)` with unit tests (DST, weekly from Monday, ToU boundaries).
- [ ] `GET /devices/:id/energy`, `energy` dashboard data mode. Integration tests (scope, cost, periods). Commit `feat(energy): consumption, tariffs and cost`.

## Task 5: Energy summary widget and tariff settings
- [ ] Widget `energy-summary` (packages/widgets) with tests; Settings → Tariffs (customer admins; platform per customer and default). Commit `feat(web): energy summary widget and tariffs`.

## Task 6: Run hours and maintenance
- [ ] `device_service` table, `device.service` permission, `GET/POST /devices/:id/services`, `GET /devices/:id/run-hours`.
- [ ] Rule type `maintenance_due` (shared schema, rules service validation), hourly scheduler job raising/clearing via `AlarmStore`; integration tests (hours, days, warnPct, cleared by a service, tenancy). Commit `feat(alarms): maintenance reminders from run hours and dates`.

## Task 7: Maintenance tab and rule form
- [ ] Device **Maintenance** tab (run hours, since service, next due, log a service, history); alarm rule form for `maintenance_due`. Web tests. Commit `feat(web): maintenance tab and reminders`.

## Task 8: Simulator and generator template
- [ ] Simulator: cumulative counters (`*_kwh`, `*_total`) rise monotonically, `*_running` toggles; firmware `GeneratorController` reports `gen_running` and an energy counter. Commit `feat(simulator): counters and running state`.

## Task 9: End-to-end, load, docs, release v0.7.0
- [ ] E2E (`e2e/energy.spec.ts`, after `fleet`): a profile with `power = v * i`, an energy counter delta and a runtime key; a customer tariff with a peak period; device data → energy summary shows consumption and cost; a maintenance rule raises after run hours, logging a service clears it.
- [ ] Load test with two formulas and a counter delta per message: criterion still met.
- [ ] Docs `docs/energy.md` (calculated keys, energy, tariffs, run hours, maintenance); update `alarms.md`, `dashboards.md`/`widgets.md`.
- [ ] `VERSION` 0.7.0, CHANGELOG, annotated tag `v0.7.0` (local; the user pushes).
