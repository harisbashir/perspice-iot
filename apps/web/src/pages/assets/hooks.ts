import type { AssetDto, AssetTreeRow, AssetTypeDto } from '@perspice/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';

export const ASSETS = ['assets'] as const;
export const ASSET_TYPES = ['asset-types'] as const;

export const useAssetTypes = () => useQuery({ queryKey: ASSET_TYPES, queryFn: () => api<AssetTypeDto[]>('/asset-types') });

export const useAssetTree = (customerId?: string) =>
  useQuery({ queryKey: [...ASSETS, 'tree', customerId ?? ''], queryFn: () => api<AssetTreeRow[]>('/assets/tree', { query: { customerId } }) });

export const useAsset = (id: string) => useQuery({ queryKey: [...ASSETS, id], queryFn: () => api<AssetDto>(`/assets/${id}`) });

/** Rows as an indented list for pickers: depth-first, children by name. */
export function flatten<T extends { id: string; parentId: string | null; name: string }>(rows: T[]): (T & { depth: number })[] {
  const ids = new Set(rows.map((r) => r.id));
  const children = new Map<string | null, T[]>();
  for (const r of rows) {
    const parent = r.parentId && ids.has(r.parentId) ? r.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), r]);
  }
  const out: (T & { depth: number })[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const r of (children.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
      out.push({ ...r, depth });
      walk(r.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** An asset and everything below it (to keep a move from going inside itself). */
export function subtreeOf(rows: { id: string; parentId: string | null }[], id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of rows) {
      if (r.parentId && out.has(r.parentId) && !out.has(r.id)) {
        out.add(r.id);
        grew = true;
      }
    }
  }
  return out;
}
