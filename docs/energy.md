# Calculated telemetry, energy and generators

Derived values computed as data arrives, energy consumption and cost with tariffs, generator run
hours, and maintenance reminders.

## Calculated keys

A device profile can define up to 20 **calculated keys** (**Device profiles → Calculated keys**).
They are computed for every message before it is stored, so they behave like any other key:
latest values, history, aggregates, widgets, alarm rules, exports. They apply to data received
from then on; history is not recalculated.

| Kind | Value | Settings |
|---|---|---|
| Formula | an expression over the device's values, e.g. `v * i * pf` | the formula |
| Counter: use since last reading | how much a cumulative counter (an energy meter) rose since its previous reading; after a reset (a smaller reading) the new reading counts | ignore jumps above (optional): a larger rise goes to the debug log instead |
| Run time | seconds the source (a boolean, or a number above 0) was running since the previous message | gaps longer than (default 900 s) count 0 |
| Level drop | how much a level (fuel) fell since the reference reading; rises (refuels) count 0 | deadband (default 0.5): smaller changes are ignored, so slow use still adds up |

**Formulas** use key names (letters, digits, `_` and `.`; write `["odd-key"]` for others),
numbers, `true`/`false`, `+ - * / % ^`, comparisons, `&& || !`, `condition ? a : b` and the
functions `abs min max round(x, decimals) floor ceil sqrt pow log exp clamp(x, lo, hi)`. They are
parsed into a checked tree and evaluated without running code; at most 500 characters. A formula
sees the values in the message over the device's latest values, so `v * i` works when `v` and `i`
arrive in different messages. Booleans count as 1/0 in arithmetic. When an input is missing or
not a number, or the result is not a finite number (e.g. a division by zero), nothing is written
for that key; the rest of the message is stored as usual. Calculated keys are evaluated in order
and can use earlier ones; their names can't repeat a telemetry key. A value the device sends under
a calculated key's name is replaced.

The editor checks definitions as you type and previews formulas on one of the profile's devices.

Counter, run time and level keys compare each reading with the previous one (kept per device);
readings older than the last one used are ignored by them.

## Energy

Energy figures come from a **per-interval** key, usually a *counter: use since last reading* key
on the meter (e.g. `energy_used` from `energy_kwh`). Per hour, the stored values are summed; hours
are grouped into days, weeks (from Monday) or months in the **customer's timezone** (UTC for
unassigned devices) and priced with the customer's tariff.

- `GET /api/devices/<id>/energy?key=energy_used&from=<ms>&to=<ms>&period=hour|day|week|month`
  returns each period's consumption and cost, the total, and the previous span's total (up to
  400 days).
- The **Energy summary** widget (dashboard data mode `energy`) shows this day, week, month or year
  so far (or the dashboard's time window), its cost, the change against the same point of the
  previous period, and bars per hour, day or month.

Periods follow the hourly buckets: in timezones with a half-hour offset they start on the hour
nearest local midnight.

### Tariffs

**Settings → Energy tariff** (permission `tariff.manage`: customer admins for their own; platform
users for the platform default and any customer's):

- a **currency** (three letters) and a **price per unit** (per kWh, or the unit of the energy key);
- optional **time-of-use periods**: a price for chosen weekdays between two local hours (e.g. peak
  17–21 on weekdays; "to" is exclusive). The first period covering an hour applies; other hours
  use the price per unit.

A customer without a tariff uses the platform default; without either, energy is shown without
cost. Each hour is priced at its own rate.

## Generators: run hours and maintenance

A *run time* key on the running state (`gen_running`) counts run hours. The device's
**Maintenance** tab shows each run time key's total and the hours since the last service
(`GET /api/devices/<id>/run-hours?key=run_s`).

**Maintenance reminders** are alarm rules of the type *Service due* (`maintenance_due`):

| Setting | |
|---|---|
| Run time key | the run time key whose hours count |
| Every (run hours) | the service interval in run hours |
| Every (days) | the service interval in days (since the last service, or since the device was added) |
| Remind at | the share of an interval at which to remind (100 % = when due; e.g. 90 % a little before) |

At least one interval is needed. The alarm says "Service due soon" before an interval is reached
and "Service due" after. Reminders are checked a minute after a device reports its run time (at
most every 5 minutes per device) and hourly for all devices (for the days).

**Log a service** on the Maintenance tab (permission `device.service`: customer admins and
operators) with a note and a date: the reminder clears, and run hours and days count from there.
Each entry records the run time totals at the time (`GET/POST /api/devices/<id>/services`).

## Example: a generator site

Profile keys `v`, `i`, `energy_kwh` (meter, kWh) and `gen_running`; calculated keys:

| Key | Kind | Definition |
|---|---|---|
| `power` | Formula | `v * i` (W) |
| `energy_used` | Counter | source `energy_kwh` (kWh) |
| `run_s` | Run time | source `gen_running` |

Then add an **Energy summary** widget on `energy_used` to the device dashboard, set the tariff, and
an alarm rule *Service due* on `run_s` every 250 run hours or 180 days. The `GeneratorController`
firmware example and the simulator (keys ending in `_kwh` rise like meters) report suitable data.
