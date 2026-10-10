# Assets

Assets organise devices the way customers think about their estate: sites containing buildings,
rooms and equipment, any depth (up to 8 levels), each with the devices attached to it.

## Asset types

**Asset types** (platform users, permission `asset.type.manage`) are shared by every customer:

- a **name** and an **icon**;
- **attributes**: the details every asset of the type records, each text, a number or a date
  (e.g. a site's address and supply in kVA);
- a **dashboard**: an asset dashboard template made for the type (see below).

A type can't be deleted while assets use it.

## The hierarchy

**Assets** (permission `asset.read`; `asset.write` to change, for customer admins) shows each
customer's assets as a tree. For every asset it rolls up its whole subtree: how many devices are
attached and their status, and open alarms with the worst severity.

- **New asset** creates a top-level asset; **Add inside** creates one under another. An asset has
  a name, a type, the type's attributes, an optional location and optionally a customer **group**:
  users limited to a group see only the assets (and devices) in their groups.
- **Edit** renames an asset, changes its attributes, or moves it to another parent (never inside
  itself; the depth limit applies to the whole moved subtree).
- An asset with sub-assets can't be deleted; deleting an asset detaches its devices.
- Platform users choose the customer at the top of the page; assets always belong to one customer,
  and an asset, its parent and its devices always share that customer.

## Devices

A device belongs to at most one asset of its customer. Attach it from the asset's **Devices** tab,
from the device page (**Asset: … Change**), or for many devices at once with the **Asset** bulk
action in the device list. A device moved to another customer leaves its asset.

The device list filters by asset (the asset and everything below it); so does the alarm list
(`GET /api/alarms?assetId=`).

## Asset pages and dashboards

An asset's page shows its breadcrumb and tabs: **Dashboard**, **Devices** (attached to the asset
itself, or anywhere below it), **Sub-assets**, **Alarms** and **Details** (attributes and location).

The dashboard is the asset type's default template. Create one under **Dashboards → New
dashboard**, choosing the asset type under "Dashboard for", then set it as the type's dashboard on
the Asset types page. Like device dashboards, each customer gets an instance it can customise.

Widgets on an asset dashboard can use **The dashboard's asset (its devices)** as their data source:
the devices attached to the asset (or its whole subtree), optionally of one profile, within the
viewer's scope. Fleet KPIs, maps, bar and pie charts accept it, and the **Energy summary** sums the
devices' energy (priced with the customer's tariff, [energy.md](energy.md)). Alarm widgets can show
only the asset's alarms.

## API

| Method and path | |
|---|---|
| `GET/POST /api/asset-types`, `PATCH/DELETE /api/asset-types/<id>` | asset types (platform) |
| `GET /api/assets/tree[?customerId=]` | every asset in scope, flat, with roll-ups |
| `GET/PATCH/DELETE /api/assets/<id>`, `POST /api/assets` | one asset (with its breadcrumb `path`) |
| `GET /api/assets/<id>/devices[?depth=children]` | its devices (the whole subtree by default) |
| `GET/PUT /api/devices/<id>/asset` | a device's asset; `{"assetId": null}` detaches |
| `GET /api/dashboards/asset/<id>` | the asset's dashboard |
| `POST /api/dashboards/data` with `assetId` | resolves `currentAsset` sources |
