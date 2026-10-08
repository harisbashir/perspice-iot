import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@perspice/shared';

export const PERMISSIONS_KEY = 'perspice:permissions';

/** Declares the permissions a handler needs; enforced by PermissionsGuard. */
export const Require = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_KEY, permissions);
