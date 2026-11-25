import { SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { CatalogPermission } from '../permissions/catalog';
import type { Scope } from './scope';

export const PERMISSION_METADATA = 'matilda:permission';
export const PUBLIC_METADATA = 'matilda:public';
export const STAFF_ONLY_METADATA = 'matilda:staff-only';

export interface PermissionRequirement {
  permission: CatalogPermission;
  /**
   * Scope of the record the request targets (from route params/body, never trusted blindly: the
   * handler must still load the record and re-check). Omit for a coarse "holds it anywhere" check.
   */
  target?: (req: Request) => Scope;
}

/** Staff-only route: the actor must hold `permission` (over `target` when given). */
export const RequirePermission = (
  permission: CatalogPermission,
  options: Pick<PermissionRequirement, 'target'> = {},
): MethodDecorator & ClassDecorator =>
  SetMetadata<string, PermissionRequirement>(PERMISSION_METADATA, { permission, ...options });

/** Explicitly public route (health checks, storefront reads). Everything else fails closed. */
export const PublicRoute = (): MethodDecorator & ClassDecorator =>
  SetMetadata(PUBLIC_METADATA, true);

/** Any signed-in staff member (2FA completed), without a specific permission (e.g. "me"). */
export const AuthenticatedStaff = (): MethodDecorator & ClassDecorator =>
  SetMetadata(STAFF_ONLY_METADATA, true);
