**Devices** lists every device you can see. Click one to open it.

## Finding devices

- **Search by name**, or filter by **status** (Online, Offline, Dead, Never connected), **profile** and **asset** (an asset includes everything below it).
- **Last seen** is when the device last sent anything.
- The list loads more as you go (**Load more**).

## Device status

| Status | Meaning |
|---|---|
| Online | It is reporting as expected. |
| Offline | It has been quiet for longer than its profile allows (five minutes by default). |
| Dead | It has been silent for a long time (a day by default). |
| Never connected | It has never sent anything. |

A device becomes online again as soon as it sends anything. Devices that sleep between reports (battery sensors) have profiles that allow for it.

## Inside a device

A device page has a header with its status, tags and **asset** (**Asset: … Change** to attach it to another one), and these tabs:

- **Dashboard**: the device's dashboard, with its live values. See [Dashboards](/help/dashboards).
- **Overview**: the latest value of every key, with the time it arrived.
- **Alarms**: the device's alarms, and the rules that apply to it.
- **History**: a chart of any values over the last hour, day, week or month (or chosen dates). Choose at least one key. Export it as CSV, Excel or PDF.
- **Location** (devices with a location): where it is. For devices placed by hand, click the map or type the coordinates.
- **Trips** (moving devices): journeys with distance, duration and speeds, and the distance per day. See [Locations, trips and geofences](/help/locations).
- **Commands**: send a command the device understands, such as *start*, with its parameters. **Recent commands** shows each one's status: *queued* (waiting for an offline device to come back, if the command was held), *sent*, then *success* or *failed* when the device answers, or *timeout* if it doesn't answer in time (30 seconds by default).
- **Attributes**: details stored about the device. *Client* attributes are reported by the device (firmware version, serial number). *Shared* attributes are configuration pushed to the device. *Server* attributes are notes kept on the platform and never sent to the device.
- **Maintenance**: run hours and the service history; **Log a service** after maintenance. See [Energy, tariffs and maintenance](/help/energy).
- **Firmware**: the device's firmware updates and their progress.
- **Credentials**: what the device needs to connect.
- **Debug**: recent messages the platform rejected or corrected, with the reason. Look here first when values don't appear.

## Selecting many devices

Tick devices in the list (or tick the header to select the whole page) to act on all of them at once:

- **Tags**: add and remove tags, keeping the others.
- **Group**: move them into one of your groups.
- **Asset**: attach them to an asset, or detach them.
- **Command**: send the same command to each.
- **Delete**: remove them with their history.

The result lists any device that failed and why; the others are done.

## Adding a device

Admins can add devices with **New device**: a **name**, its **profile** (the kind of device) and optional **tags**. The device's **token** is shown once: copy it straight into the device's configuration along with the details on its **Credentials** tab. If it is lost, ask your platform provider to regenerate it.

## Adding a device with a claim code

Some devices arrive with a **claim code** on their label, such as `ABCD-EFGH-JKMN`. Choose **Add with claim code**, type the code (case, spaces and dashes don't matter) and optionally a name. The device joins your organisation. A code works once.

:::platform
## Creating and importing devices

- **New device** for platform users also offers a **customer** (empty = unassigned, owned by the platform). Customer admins create devices in their own customer; platform users can create unassigned stock with a claim code through the API (`withClaimCode`).
- **Import**: up to 5,000 devices from a CSV with the columns `name`, `profile` (name or id), `customer` (slug or name), `group`, `tags` (`;`-separated), `lat`, `lng` and `claim` (`yes` gives an unassigned device a claim code). *Check* reports every problem by row; a file with any error imports nothing. After the import, **Download credentials (CSV)** once: tokens and claim codes can't be shown again.
- **Assign** (bulk action, platform only): move devices to a customer, or back to unassigned. A device that changes customer leaves its asset and group.
- Bulk actions also run over the API: `POST /api/devices/bulk` with up to 500 ids.

## Credentials

The **Credentials** tab shows the MQTT host, ports (8883 TLS; 1883 plain if enabled), client id/username (the device id), and **Regenerate token** (needs `device.credentials`), which disconnects the device and invalidates the old token. On AWS IoT Core installs it offers the certificate and private key instead. See [Connecting devices](/help/connecting-devices).

## Debug tab

Lists rejected messages (bad JSON, invalid key names, too large, a topic outside the device's own) and corrected ones (timestamps before 2020 or more than an hour ahead are replaced by the receive time). Calculated keys that couldn't be computed and invalid position fixes appear here too.
:::
