**Asset types** are the kinds of things customers build their asset trees from: *Site*, *Building*, *Generator*, *Tank*. They are shared by every customer, and only platform users manage them. Customers then create the actual assets (*Site 4*, *Generator 1*) and attach their devices. See [Assets](/help/assets) for the customer side.

## What a type defines

| Part | What it does | Example for *Site* |
|---|---|---|
| **Name** | What customers choose when they create an asset. | Site |
| **Icon** | Shown in the asset tree (a [lucide](https://lucide.dev/icons) icon name). | `building` |
| **Attributes** | The details every asset of the type records. Each has a key, a label and a type: text, number or date. | `address` (text), `supply_kva` (number), `commissioned` (date) |
| **Dashboard** | The asset dashboard template its assets show. | *Site overview* |

A type can't be deleted while assets use it.

## Designing types

Start from how customers talk about their estate. Ask: *what do they look after, and what does it contain?*

1. **One type per kind of place or equipment** that someone would want to see on its own: a site, a building, a plant room, a generator. Don't make a type for something that only ever has one device and no details of its own; attach the device to its parent instead.
2. **Attributes are facts about the asset, not measurements.** The supply rating, the address, the install date, the fuel tank's capacity: yes. The fuel level: no, that is telemetry from a device attached to it.
3. **Keep the tree shallow.** Two to four levels covers most estates (up to 8 are allowed).

## Giving a type a dashboard

1. Under **Dashboards → New dashboard**, choose the asset type under **Dashboard for**.
2. Build it in the editor. Widgets read **the dashboard's asset (its devices)**: the devices attached to the asset, or everywhere below it, optionally only those of one profile. Useful widgets:
   - **Fleet KPI**: devices online, offline and dead in the asset;
   - **Map**: the asset's devices;
   - **Bar chart** and **Pie / donut**: compare a value across its devices;
   - **Energy summary**: the energy of all its meters added up, priced with the customer's tariff;
   - **Active alarms** and **Alarm table**, set to show only the asset's alarms.
3. Until a customer has an asset of that type, the editor previews with sample data.
4. Back on **Asset types**, **Edit** the type and choose the template under **Dashboard**.

Each customer gets their own copy of the dashboard, which their admins can customise, just like device dashboards.

## Worked example: telecom towers

| Type | Attributes | Dashboard shows |
|---|---|---|
| Site | address, grid supply (kVA), landlord | devices online, open alarms, map, energy this month |
| Generator | rating (kVA), fuel capacity (l), last overhaul (date) | (often none: the generator controller's own device dashboard is enough) |
| Tank | capacity (l) | — |

The customer then builds *Site 4 → Generator 1, Tank* and attaches the generator controller and the level sensor to them.
