import { z } from 'zod';
import type { AlarmSeverity } from './alarms.js';
import { KEY_PATTERN } from './protocol.js';

/**
 * Asset hierarchy (spec §4 `asset`, §11): typed assets per customer (sites containing equipment),
 * with devices attached. Shared by the server, the web app and tests.
 */

const Uuid = z.string().uuid();
export const ASSET_MAX_DEPTH = 8;

export const ASSET_ATTRIBUTE_TYPES = ['text', 'number', 'date'] as const;
export const AssetAttributeDefSchema = z.object({
  key: z.string().regex(KEY_PATTERN, 'Use letters, digits, ".", "_" or "-" (up to 64)'),
  label: z.string().trim().min(1).max(100),
  type: z.enum(ASSET_ATTRIBUTE_TYPES),
});
export type AssetAttributeDef = z.infer<typeof AssetAttributeDefSchema>;

export const AssetTypeInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  /** A short icon name (e.g. building, factory, zap). */
  icon: z.string().regex(/^[a-z-]{1,30}$/).default('building'),
  attributes: z
    .array(AssetAttributeDefSchema)
    .max(30)
    .default([])
    .refine((a) => new Set(a.map((x) => x.key)).size === a.length, 'Attribute keys must be unique'),
  defaultDashboardTemplateId: Uuid.nullish().transform((v) => v ?? null),
});
export type AssetTypeInput = z.infer<typeof AssetTypeInputSchema>;

export interface AssetTypeDto extends AssetTypeInput {
  id: string;
  /** Assets of this type (any customer); a type in use can't be deleted. */
  assetCount: number;
  createdAt: number;
  updatedAt: number;
}

export type AssetAttributeValue = string | number | null;

export const AssetInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  typeId: Uuid,
  parentId: Uuid.nullish(),
  /** Platform users choose the customer; customer users always create in their own. */
  customerId: Uuid.optional(),
  groupId: Uuid.nullish(),
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).nullish(),
  attributes: z.record(z.union([z.string().max(1000), z.number(), z.null()])).default({}),
});
export type AssetInput = z.infer<typeof AssetInputSchema>;
export const AssetPatchSchema = AssetInputSchema.omit({ customerId: true, typeId: true }).partial();

export interface AssetDto {
  id: string;
  name: string;
  typeId: string;
  typeName: string;
  customerId: string;
  groupId: string | null;
  parentId: string | null;
  location: { lat: number; lng: number } | null;
  attributes: Record<string, AssetAttributeValue>;
  /** Ancestors from the root, for breadcrumbs. */
  path: { id: string; name: string }[];
  createdAt: number;
  updatedAt: number;
}

/** Device status and open alarms over an asset's subtree. */
export interface AssetRollup {
  devices: number;
  online: number;
  offline: number;
  dead: number;
  never: number;
  alarms: number;
  worstSeverity: AlarmSeverity | null;
}

export interface AssetTreeRow {
  id: string;
  name: string;
  typeId: string;
  parentId: string | null;
  customerId: string;
  rollup: AssetRollup;
}

export type AssetTreeNode<T extends { id: string; parentId: string | null; name: string } = AssetTreeRow> = T & { children: AssetTreeNode<T>[] };

/** Nests a flat list; rows whose parent isn't in the list (outside the viewer's groups) become roots. */
export function buildAssetTree<T extends { id: string; parentId: string | null; name: string }>(rows: readonly T[]): AssetTreeNode<T>[] {
  const nodes = new Map(rows.map((r) => [r.id, { ...r, children: [] as AssetTreeNode<T>[] }]));
  const roots: AssetTreeNode<T>[] = [];
  for (const n of nodes.values()) {
    const parent = n.parentId ? nodes.get(n.parentId) : undefined;
    (parent ? parent.children : roots).push(n);
  }
  const sort = (list: AssetTreeNode<T>[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name));
    for (const n of list) sort(n.children);
  };
  sort(roots);
  return roots;
}

/** Attribute values must match the type's definitions (null clears a value). */
export function checkAssetAttributes(defs: readonly AssetAttributeDef[], values: Record<string, unknown>): { key: string; message: string }[] {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const issues: { key: string; message: string }[] = [];
  for (const [key, v] of Object.entries(values)) {
    const def = byKey.get(key);
    if (!def) {
      issues.push({ key, message: `Unknown attribute "${key}"` });
      continue;
    }
    if (v === null) continue;
    if (def.type === 'number' && (typeof v !== 'number' || !Number.isFinite(v))) issues.push({ key, message: `${def.label} must be a number` });
    if (def.type === 'text' && typeof v !== 'string') issues.push({ key, message: `${def.label} must be text` });
    if (def.type === 'date' && (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)))) {
      issues.push({ key, message: `${def.label} must be a date (YYYY-MM-DD)` });
    }
  }
  return issues;
}
