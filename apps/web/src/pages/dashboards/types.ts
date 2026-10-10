import type { DashboardDefinition } from '@perspice/shared';

export interface TemplateDto {
  id: string;
  name: string;
  kind: 'device' | 'overview' | 'asset';
  profileId: string | null;
  /** Asset templates: the asset type. */
  assetTypeId: string | null;
  definition: DashboardDefinition;
  version: number;
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
}
