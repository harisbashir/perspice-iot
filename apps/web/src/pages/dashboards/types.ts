import type { DashboardDefinition } from '@perspice/shared';

export interface TemplateDto {
  id: string;
  name: string;
  kind: 'device' | 'overview';
  profileId: string | null;
  definition: DashboardDefinition;
  version: number;
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
}
