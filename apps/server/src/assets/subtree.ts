import { ASSET_MAX_DEPTH } from '@perspice/shared';
import { type AnyColumn, type SQL, sql } from 'drizzle-orm';
import { asset, assetDevice } from '../db/schema';

/**
 * `device_id IN (devices attached anywhere in the asset's subtree)` for a device id column, as plain
 * SQL so device and alarm lists can filter by asset without depending on the assets service. The
 * caller's own scope conditions still apply.
 */
export function inAssetSubtree(deviceIdColumn: AnyColumn, assetId: string): SQL {
  return sql`${deviceIdColumn} IN (
    WITH RECURSIVE sub(id, lvl) AS (
      SELECT ${assetId}::uuid, 1
      UNION ALL SELECT c.id, sub.lvl + 1 FROM ${asset} c JOIN sub ON c.parent_id = sub.id WHERE sub.lvl < ${ASSET_MAX_DEPTH + 1}
    ) SELECT ad.device_id FROM ${assetDevice} ad JOIN sub ON ad.asset_id = sub.id)`;
}
