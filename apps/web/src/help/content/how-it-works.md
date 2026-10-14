This page explains the handful of ideas the rest of the platform is built on. Once these make sense, every page will.

## Devices send data, the platform keeps it

A **device** is anything that reports measurements: a generator controller, an energy meter, a temperature sensor, a GPS tracker. Each device connects to the platform over the internet and sends **telemetry**: named values such as `fuel_level = 64.5` or `door_open = false`, each with the time it was measured.

The platform stores every value, so you can see what a device reports **now** (its latest values) and what it reported **before** (its history, as charts and tables).

A device is **online** while it keeps sending, **offline** when it has been quiet longer than expected, and **dead** after a long silence (a day, by default). Devices that have never connected show as **never**.

Devices can also **receive commands**, for example *start generator* or *reboot*, if their maker built them to.

## Profiles describe a kind of device

Every device has a **device profile**: the description shared by all devices of one kind. The profile lists the values the device sends (with labels, units and decimals), the commands it accepts, how long it may stay quiet before it counts as offline, and whether it has a location.

Because all devices of a profile look the same, one dashboard and one set of alarm rules can serve all of them.

## Dashboards show the data

A **dashboard** is a page of widgets: gauges, value cards, charts, maps, tables and buttons.

- Opening a device shows its profile's dashboard, filled with **that device's** data.
- The **Overview** is the dashboard everyone lands on: counts of devices by status and a table of all your devices.
- Your organisation can **customise** a dashboard to suit it; nobody else is affected.

Values on dashboards update live, without reloading the page.

## Alarms tell you when something is wrong

An **alarm rule** watches device data, for example *fuel below 20 %* or *device offline*. When the condition is met, the platform raises an **alarm** and notifies the people concerned by email, push notification or the bell in the top bar.

An alarm stays **active** until someone **acknowledges** it, and is **cleared** when the condition goes away. See [Alarms and alarm rules](/help/alarms).

## Assets organise devices the way you think about your estate

**Assets** are the places and things your devices belong to: a site, the building on it, the generator room inside, the generator itself. Assets form a tree, and every level adds up what is below it: how many devices are online, and the open alarms.

Each asset has an **asset type** (Site, Building, Generator…) that decides which details it records, such as an address or a supply rating, and which dashboard it shows. See [Assets](/help/assets).

## Who sees what

- Your **organisation** (a *customer* of the platform) sees only its own devices, assets, alarms and users. Nothing of other organisations is ever visible.
- Within your organisation, **groups** can narrow it further: someone limited to a group sees only the devices and assets in that group.
- What each person may **do** depends on their **role**: viewers look, operators also send commands and acknowledge alarms, admins also manage users, rules and settings. See [Users, roles and permissions](/help/users-roles).

:::platform
## The platform side

The platform is multi-tenant. Platform users (super admins, platform admins and support) work **across all customers**; customer users only ever within their own.

- **Customers** are tenants, each served on its own subdomain (`acme.<your domain>`) with its own branding. Customer users can only sign in on their customer's subdomain; platform users sign in on the main domain.
- Platform users own the shared building blocks: **device profiles**, **dashboard templates**, **asset types**, **firmware images** and profile-wide **alarm rules**. Customers use these but can't change them.
- Each customer gets its own **instance** of a dashboard template, which they can customise without affecting other customers.

Data flows like this: devices publish over MQTT (or HTTP) → the `ingest` service validates and stores the telemetry, computes calculated keys and updates presence → the `rules` service evaluates alarm rules → the `api` service serves the web app and pushes live updates over WebSockets. The `scheduler` runs timers (offline sweep, backups, large exports, scheduled reports). See [Setting up from scratch](/help/first-steps) for the order to build things in.
:::
