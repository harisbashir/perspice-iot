A **device profile** describes one kind of device: what it sends, what it accepts, how it connects and how its presence is judged. Every device has exactly one profile, and dashboards, alarm rules and firmware are all attached to profiles, so getting the profile right is the foundation of everything else.

Customers can see profiles (read-only); only platform users with `profile.write` change them.

## General

- **Name** and **Description**.
- **Transport**: **MQTT** (recommended: live commands, instant presence) or **HTTP** (devices that only make web requests; commands are long-polled). On AWS IoT Core installs, MQTT devices connect to IoT Core.
- **History retention (days)**: how long this profile's history is meant to be kept. It is recorded on the profile, but this version doesn't delete older data automatically yet: all history is kept.

## Telemetry keys

Every value the device sends, one row per **key**:

| Column | Meaning |
|---|---|
| Key | The exact name in the device's messages, e.g. `fuel_level`. Letters, digits, `_ . -`, up to 64 characters. Case matters. |
| Label | The human name on dashboards and in tables: *Fuel level*. |
| Type | `number`, `boolean`, `string` or `json`. |
| Unit | Shown after values: `%`, `V`, `°C`, `kWh`. |
| Decimals | How many to show (values are stored exactly as sent). |

The device may also send keys not listed here; they are stored, but dashboards and rules offer only listed keys, so list everything that matters.

## Commands

Commands the device understands: a **name** (what the firmware receives, e.g. `gen_start`), a **label** for buttons, an optional **parameter schema** (JSON Schema, which also builds the form when sending the command), and whether the app asks for **confirmation** first. Devices must answer within the command's time-to-live (30 s by default) or the command is marked *timeout*.

## Presence

- **Offline after (seconds)**: how long without a message before the device is *offline* (default 300). Set it to about three report intervals, so one lost message doesn't flag it.
- **Dead after (seconds)**: when it becomes *dead* (default 86,400 = a day).
- **Sleepy**: for devices that disconnect between reports (deep-sleep sensors). Disconnecting doesn't mark them offline; only the timeout does.

Both timeouts can be overridden per device.

## Status notifications

Notify customer and platform admins (by email and in-app) when this profile's devices go **offline**, **dead** or come **back online**. For more control (severity, schedules, chosen people) use alarm rules of the type *Device status* instead.

## Location

**None**, **Fixed, set by hand**, or **Reported by the device**, with the telemetry keys carrying latitude, longitude, speed, heading, accuracy and altitude, and **Detect trips** for moving devices. See [Locations, trips and geofences](/help/locations).

## Calculated keys

Values computed from the device's data as it arrives: formulas (`v * i`), energy used from a meter counter, run time, fuel used. They behave like ordinary keys everywhere. See [Energy, tariffs and maintenance](/help/energy).

## Changing a profile

Changes apply immediately to every device of the profile, in every customer. Renaming or removing a key doesn't rename stored data: dashboards and rules using the old name stop finding values. Add the new key, update the firmware, then the dashboards and rules, and remove the old key last.

A profile's dashboard is chosen on the **Dashboards** page (**Generate from profile**, or a template's *Use for all … devices*). Its firmware images are under **Firmware**.
