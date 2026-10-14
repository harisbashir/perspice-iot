The platform turns meter readings into **consumption and cost**, counts **run hours** of generators and machines, and reminds you when **maintenance** is due.

## Energy on dashboards

The **Energy summary** widget shows how much was used **today**, **this week**, **this month** or **this year** so far (or over the dashboard's time window), what it cost, and the change against the same point of the previous period, with bars per hour, day or month.

Days, weeks (starting Monday) and months follow **your organisation's timezone**. On an asset's dashboard, the summary adds up every meter in the asset.

## Your tariff

Under **Settings → Energy tariff**, admins set what energy costs:

- **Currency**, as three letters (`GBP`, `USD`, `PKR`…).
- **Price per unit**: per kWh (or whatever unit your meters report).
- Optional **time-of-use periods**: a different price on chosen days between two hours, for example *Peak, Mon–Fri, 17–21* at a higher price. "To" is exclusive: 17–21 means 17:00 to 21:00. The first period that covers an hour applies; other hours use the price per unit.

Each hour is priced at its own rate, so a day's cost is correct even when it spans peak and off-peak. Without a tariff of your own, the platform's default applies; without either, energy shows without cost.

## Run hours and maintenance

Generators and machines that report whether they are running get a **run hours** count. A device's **Maintenance** tab shows:

- the **run hours** in total and since the last service;
- the **service history**.

After maintenance, use **Log a service** with the date it was **done on** and a **note** (e.g. *oil and filters changed*). Reminders count again from there.

**Service reminders** are alarm rules of the type **Service due**: every so many **run hours** and/or every so many **days**, with an optional early reminder (**Remind at 90 %** reminds a little before it is due). The alarm says *Service due soon* first, then *Service due*, and clears when you log a service.

:::platform
## Calculated keys behind it

Energy and run hours come from **calculated keys** on the device profile (**Calculated keys** in the profile editor), computed as each message arrives:

| Kind | Produces | Typical use |
|---|---|---|
| Formula | an expression over the device's values, e.g. `v * i * pf` | power from voltage and current |
| Counter: use since last reading | how much a cumulative counter rose since its previous reading (resets handled) | `energy_used` from the meter's `energy_kwh` |
| Run time | seconds the source (boolean, or a number above 0) was running since the previous message | `run_s` from `gen_running` |
| Level drop | how much a level fell since the reference reading, ignoring refills | fuel used |

The Energy summary sums a **per-interval** key (the counter kind) per hour and groups the hours by the customer's timezone; it doesn't work on a raw cumulative meter reading. Calculated keys apply to data received from then on (history isn't recalculated). Formulas are parsed and evaluated safely (no code runs), at most 500 characters, with `+ - * / % ^`, comparisons, `&& || !`, `a ? b : c` and `abs min max round floor ceil sqrt pow log exp clamp`. The editor previews a formula on one of the profile's devices.

Platform users set the **Platform default** tariff and any customer's (**Tariff for**). Maintenance reminders need a *Run time* key for run-hour intervals; logging services needs `device.service`.

API: `GET /api/devices/<id>/energy?key=&from=&to=&period=hour|day|week|month`, `GET /api/devices/<id>/run-hours?key=`, `GET/POST /api/devices/<id>/services`.
:::
