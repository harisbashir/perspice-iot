**Assets** organise your devices the way you think about your estate: sites containing buildings, rooms and equipment, to any depth (up to 8 levels), with devices attached where they belong.

## Why use assets

Without assets you see a flat list of devices. With them you can ask questions about **places and equipment**:

- *Is everything at Site 4 working?* The site's row shows how many of its devices are online, offline or dead, and its open alarms with the worst severity, counting everything below it.
- *What does the whole site use?* An asset dashboard can add up the energy of every meter in the site.
- *Show me only the generator room's devices.* The device and alarm lists can filter by asset.

## An example

A telecom company with tower sites might build:

```
Site 4 (Site)
├── Shelter (Building)
│   ├── Generator 1 (Generator)  ← generator controller attached
│   └── Rectifier (Equipment)    ← power monitor attached
└── Fuel tank (Tank)             ← level sensor attached
```

*Site*, *Building*, *Generator* and *Tank* are **asset types**. Each type decides what details its assets record (a site's address and grid supply in kVA; a generator's rating and fuel capacity), its icon, and the dashboard its assets show. The platform provides the types; you create the assets.

## Building your tree

- **New asset** creates a top-level asset; **Add inside** creates one under another.
- Give it a **name** and **type**, fill in the type's details, and optionally a **location** and a **group** (people limited to a group see only its assets).
- **Edit** renames an asset, changes its details, or moves it somewhere else in the tree (**Inside**). Everything below it moves too.
- An asset with sub-assets can't be deleted; delete or move those first. Deleting an asset leaves its devices in place, detached.

## Attaching devices

A device belongs to at most one asset. Attach devices:

- on the asset's **Devices** tab (**Attach a device…**);
- from the device page (**Asset: … Change**);
- or for many at once, with the **Asset** action in the device list.

## An asset's page

- **Dashboard**: its type's dashboard, adding up its devices.
- **Devices**: those attached to this asset itself, or everywhere inside it.
- **Sub-assets**: the assets directly inside it.
- **Alarms**: the open alarms of its devices.
- **Details**: its type's details and its location.

The breadcrumb at the top shows where it sits in the tree.

:::platform
## For platform users

- Assets always belong to one customer; choose the customer at the top of **Assets** (*All customers* shows every tree). An asset, its parent and its attached devices always share that customer, and a device moved to another customer leaves its asset.
- Asset types are managed under **Asset types**; see [Asset types](/help/asset-types) for how to design them.
- Roll-ups and the subtree filters are computed with recursive queries, within the viewer's scope (a group-limited user's counts include only their groups' devices).
- API: `GET /api/assets/tree[?customerId=]`, `POST /api/assets`, `GET/PATCH/DELETE /api/assets/<id>`, `GET /api/assets/<id>/devices[?depth=children]`, `PUT /api/devices/<id>/asset`.
:::
