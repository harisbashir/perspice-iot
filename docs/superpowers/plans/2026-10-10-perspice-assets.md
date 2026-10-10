# Perspice IoT — Sub-project 5d: Asset Hierarchy Implementation Plan

> **For agentic workers:** execute task by task. Each task is test-first (write the failing test, see it fail, implement, see it pass) and ends with one conventional commit. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v0.8.0: an asset hierarchy per customer (sites containing equipment, any depth), devices attached to assets, asset types with attributes and a default dashboard, asset dashboards whose widgets read the asset's devices (latest values, stats, maps, device lists and summed energy), status and alarm roll-ups in an asset tree, and assets in bulk actions and alarm filters.

**Architecture:** builds on v0.7.0. New server module `assets` (asset types, assets, device attachment, roll-ups). Dashboards gain template kind `asset` (bound to an asset type) with instances per customer like device dashboards, a `currentAsset` data source (the asset's devices: direct or the whole subtree), and asset context in data queries. Scoping follows devices exactly: an asset belongs to one customer and optionally a customer group.

**Tech additions:** none.

**Spec:** §4 (`asset`, `asset_device`), §7.1 (template kind `asset`), §7.2 (`asset(A).children`), §11 (asset hierarchy with asset dashboards), §13 row 5.

## Scope decisions

| Item | Decision |
|---|---|
| Asset types | Platform-managed (`asset.type.manage`, platform only): name, icon (a short word), an attribute list (`{ key, label, type: text\|number\|date }`, ≤ 30) and a default asset dashboard template. Used by every customer. A type in use can't be deleted. |
| Assets | `asset`: customer (required), group (optional, like devices), type, name, parent (same customer; no cycles; depth ≤ 8), optional fixed location, attribute values (validated against the type). Customers manage their own (`asset.write`: customer admins; `asset.read`: every customer role); platform users manage any customer's. Deleting an asset with sub-assets is refused; its devices are detached. Moving checks cycles and customer. |
| Devices | A device belongs to at most one asset (`asset_device`, device unique), of the same customer; attaching requires `asset.write` and the device in scope. A device that changes customer is detached. Bulk action `asset` attaches/detaches many. |
| Roll-ups | The tree shows per asset (subtree): device count, online/offline/dead/never counts, and open alarms by worst severity. Computed in SQL with a recursive CTE, scoped. |
| Asset dashboards | Template kind `asset` with `assetTypeId`; instances per (template, customer) as for devices (customer admins can customise theirs). `GET /dashboards/asset/:id` resolves the asset's type's default template. |
| `currentAsset` source | `{ depth: 'children' \| 'subtree', profileId?, filter?, keys }`: modes `latest` (fleet format), `stats`, `locations`, `list` (entity table) and `energy` (one key summed over the devices, priced with the customer's tariff). Alarms source gains `currentAssetOnly`. |
| Tenancy | Every asset query goes through `scoped()` (customer and group); cross-tenant ids are 404 (Review Focus 1). |

## Global Constraints

- An asset, its parent and its devices always share a customer; a group-limited user sees only assets in their groups (Review Focus 1).
- The tree can't loop and stays shallow; queries over a subtree are bounded (Review Focus 2).
- Asset dashboards only ever read devices of that asset, within the viewer's scope (Review Focus 3).

## Review Focus

1. **Tenancy** — another customer's asset as parent, device, or in a data request; group-limited users. Expect 404/400. Tests in Tasks 2, 3, 4.
2. **Tree integrity** — moving an asset under its own descendant, depth over 8, deleting with children. Expect 400/409. Tests in Task 2.
3. **Dashboard scope** — `currentAsset` with a foreign asset id; devices of sub-assets with `children`. Tests in Task 4.

---

## Task 1: Contracts (`packages/shared/src/assets.ts`)
- [ ] Schemas and DTOs: asset types (attribute definitions), assets (input, DTO with path and roll-up), attachment, tree node; permissions `asset.read`, `asset.write`, `asset.type.manage`; data source `currentAsset`, alarms `currentAssetOnly`, template kind `asset`, `DataQuery.assetId`; bulk action `asset`. Unit tests. Commit `feat(shared): asset contracts`.

## Task 2: Asset types and assets (server)
- [ ] Tables `asset_type`, `asset`, `asset_device`; migrations; services and controllers (`/asset-types`, `/assets`, `/assets/tree`, `/assets/:id/devices`, `/devices/:id/asset`); tree checks; roll-ups. Integration tests (tenancy, groups, cycles, depth, delete, detach on customer change). Commit `feat(assets): asset types, assets and devices`.

## Task 3: Bulk and filters
- [ ] Bulk action `asset`; device list filter `assetId` (with subtree); alarm list filter `assetId`. Tests. Commit `feat(assets): bulk attach and asset filters`.

## Task 4: Asset dashboards
- [ ] Template kind `asset` (assetTypeId), instances per customer, `GET /dashboards/asset/:id`, asset type default template; `currentAsset` data source for latest/stats/locations/list/energy, alarms `currentAssetOnly`. Integration tests. Commit `feat(dashboards): asset dashboards`.

## Task 5: Web — asset types and the asset tree
- [ ] Asset types page (platform): attributes, default dashboard. Assets page: tree with roll-ups, create/edit/move/delete, attributes form from the type. Web tests. Commit `feat(web): asset types and the asset tree`.

## Task 6: Web — asset pages and dashboards
- [ ] Asset page: dashboard, Devices (attach/detach), Sub-assets, Alarms, Attributes; device page breadcrumb and "Asset" field; builder support for asset templates and the `currentAsset` source; bulk "Asset" action; asset filter on devices and alarms. Web tests. Commit `feat(web): asset pages and dashboards`.

## Task 7: End-to-end, docs, release v0.8.0
- [ ] E2E (`e2e/assets.spec.ts`, after `energy`): the platform defines a "Site" type with a dashboard; Acme builds Site → Generator room, attaches devices, sees roll-ups and the site dashboard (latest values of its devices, summed energy); a group-limited user sees only their site.
- [ ] Docs `docs/assets.md`; update `dashboards.md`, `widgets.md`.
- [ ] `VERSION` 0.8.0, CHANGELOG, annotated tag `v0.8.0` (local; the user pushes).
