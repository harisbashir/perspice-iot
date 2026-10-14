# Fleet operations

Firmware updates over the air, adding devices in bulk (CSV import and claim codes), and actions on
many devices at once.

## Firmware updates (OTA)

### Images

**Firmware** (platform admins, permission `firmware.manage`) holds the images per device
profile: upload a `.bin` (up to 16 MB) with its **version**, exactly as the firmware reports it in
its `fw` attribute (e.g. `1.2.0`). The platform stores the image with its size and SHA-256. A
version can be uploaded once per profile; an image used by an update can't be deleted.

### Rolling out

**Deploy** a version to the profile's devices, optionally only one customer's and/or only those
with all of some tags (the API also takes a list of device ids). Devices already on the version
are skipped. The update then runs in the scheduler, every 15 s:

1. It sends the update to more **online** devices while fewer than a **batch** (default 10) are
   in progress. Offline devices wait until they come back.
2. A device that hasn't finished within the **timeout** (default 30 min) fails with
   "Timed out".
3. Once a batch worth of devices has finished, the update **halts** if more than the
   **failure threshold** (default 20 %) of them failed. Nothing more is sent; devices already
   updating finish. The halt reason is shown on the update's page.
4. It **completes** when every device has finished.

A device is **updated** only when it reports the new version as its `fw` attribute after
restarting; its own `applied` message alone leaves it at *verifying*. **Cancel** stops sending
(waiting devices are skipped). Customers see their devices' updates on the device's
**Firmware** tab, but not the updates themselves.

States per device: `pending` → `sent` → `downloading` → `verifying` → `applied`, or `failed`
(with the device's reason) or `skipped`.

### What the device does

The platform publishes to `perspice/v1/<id>/ota` (not retained; sent again when a device that
had it reconnects):

```json
{"jobId":"<uuid>","version":"1.2.0","url":"https://iot.example.com/api/firmware/…","sha256":"<64 hex>","size":524288}
```

The link works for 24 hours without other credentials. The device downloads the image, checks the
size and the SHA-256 **before** using it, and reports on `perspice/v1/<id>/ota/progress`:

```json
{"version":"1.2.0","state":"downloading","pct":40}
{"version":"1.2.0","state":"failed","error":"checksum mismatch"}
```

`state` is `downloading`, `verifying`, `applied` or `failed`. After restarting into the new image
it reports `{"fw":"1.2.0"}` on `attributes`, which completes the update. HTTP devices poll
`GET /api/v1/device/ota` (the same message, or `204`) and report to
`POST /api/v1/device/ota/progress`. See [device-protocol.md](device-protocol.md).

The [PerspiceClient library](firmware.md) does all of this on ESP32: set
`cfg.firmwareVersion`, see the `OtaUpdate` example. It writes to the inactive app partition, so a
failed or corrupt download never touches the running image, and marks the new image valid once it
connects (with rollback enabled in the bootloader, an image that can't connect is replaced by the
previous one at the next restart). Set `cfg.otaCaCert` to also verify the download server.

The simulator takes updates too: `perspice-sim … --fw 1.0.0 --ota`.

## Adding devices

For units made in quantity, see [provisioning.md](provisioning.md): one provisioning key in the
firmware lets every unit fetch its own credentials on first boot.

### CSV import

Platform admins import up to 5,000 devices from **Devices → Import**
(`POST /api/devices/import`, body `text/csv`, `?dryRun=true` to only check):

| Column | |
|---|---|
| `name` | required |
| `profile` | required; profile name or id |
| `customer` | customer slug or name; empty = unassigned |
| `group` | group name within that customer |
| `tags` | separated by `;` |
| `lat`, `lng` | a fixed location (profiles that use locations) |
| `claim` | `yes` gives an unassigned device a claim code |
| `serial` | the unit's serial (unique within the profile), for provisioning keys |

**Check** reports every problem by row and field; a file with any error imports nothing. A clean
file is created in one transaction, and the **credentials CSV** (id, name, token, claim code) is
offered once: tokens and claim codes aren't stored in readable form and can't be shown again
(regenerate a token on the device's Credentials tab, a claim code with
`POST /api/devices/<id>/claim-code`).

### Claim codes

For devices shipped to customers: the platform creates them unassigned with a claim code
(**New device** with `withClaimCode` in the API, or `claim=yes` in an import) and puts the code on
the label, e.g. `ABCD-EFGH-JKMN` (12 characters without 0/O, 1/I/L; case, spaces and dashes
don't matter). A customer admin (permission `device.claim`) enters it under **Devices → Add with
claim code**, optionally with a name, and the device joins their customer.

Codes are stored only as hashes and work once. Every wrong, used or unknown code gets the same
answer, and a user can try 10 codes a minute.

## Bulk actions

Select devices in the device list (or call `POST /api/devices/bulk` with up to 500 ids):

| Action | Permission | |
|---|---|---|
| Tags | `device.write` | add and remove tags, keeping the others |
| Group | `device.write` | move into a group of the customer (customer users) |
| Assign | `device.write` | to a customer or unassigned (platform only) |
| Command | `device.command` | one command with the same parameters to each device |
| Delete | `device.write` | with their history |

Each device goes through the same checks as a single change; devices outside your scope are
reported as not found and left alone. The result lists every device that failed and why, and one
audit entry records the action with all the ids.
