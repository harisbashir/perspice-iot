**Firmware** updates devices over the air (OTA): upload an image for a profile, then roll it out in batches, with automatic halting if too many fail.

## Uploading an image

**Upload firmware**: choose the **profile**, the **version** exactly as the firmware reports it in its `fw` attribute (e.g. `1.2.0`), the **image (.bin)** (up to 16 MB) and optional notes. The platform records its size and SHA-256. A version can be uploaded once per profile, and an image used by an update can't be deleted.

## Rolling out

**Deploy** an image, choose the following, then **Start update**:

- **Customer** (or all) and **Only devices with these tags** (leave empty for all), to start small;
- **Batch size**: how many devices update at the same time (default 10);
- **Timeout (min)**: how long a device may take before it counts as failed (default 30);
- **Halt above (% failed)**: stop sending once more than this share of a finished batch failed (default 20 %).

Devices already on the version are skipped. Every 15 seconds, the platform sends the update to more **online** devices while fewer than a batch are in progress; offline devices wait until they come back. If too many fail, the update **halts** (devices already updating finish) and the page shows why. **Cancel** stops sending.

A device counts as **updated** only when it restarts and reports the new version; its own "applied" message isn't enough. Each device goes *Pending → Sent → Downloading → Verifying → Updated*, or *Failed* (with the device's reason) or *Skipped*.

Customers see their devices' progress on each device's **Firmware** tab, but not the update itself.

## A safe rollout

1. Upload the image; deploy to **one test device** (a tag such as `canary`).
2. Check it comes back online, reports the new version, and its values look right.
3. Deploy to one customer, or a tag covering a few percent of devices, with a small batch.
4. Then everyone, with the default batch and halt threshold.

## What the device does

The device receives on `perspice/v1/<id>/ota`:

```json
{"jobId":"…","version":"1.2.0","url":"https://…/api/firmware/…","sha256":"…","size":524288}
```

It downloads the image (the link works for 24 hours), checks the size and SHA-256 **before** using it, reports progress on `…/ota/progress` (`downloading` with `pct`, `verifying`, `applied`, or `failed` with an `error`), restarts into the new image and reports `{"fw":"1.2.0"}` on `attributes`. The Arduino library does all of this on ESP32, writing to the inactive partition so a bad download never touches the running image. HTTP devices poll `GET /api/v1/device/ota`.
