import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { RequestContextService } from '../../../common/context/request-context.service';
import { ApiException } from '../../../common/errors/api-exception';
import { APP_ENV, type Env } from '../../../config/env';
import { AuditService } from '../../audit/audit.service';
import { assertAllowedOrigin, assertCsrf, readStaffToken } from '../../staff-auth/request-security';
import { type SessionInfo, StaffSessionService } from '../../staff-auth/session.service';
import { isSensitivePermission } from '../permissions/catalog';
import { AuthorizationService } from './authorization.service';
import {
  PERMISSION_METADATA,
  PUBLIC_METADATA,
  STAFF_ONLY_METADATA,
  type PermissionRequirement,
} from './decorators';
import { can, canAnywhere, type Grant } from './scope';

export type RequestWithAuth = Request & { grants?: Grant[]; staffSession?: SessionInfo };

/**
 * Global guard, fail-closed. A route must be `@PublicRoute()`, `@AuthenticatedStaff()` or declare
 * `@RequirePermission(...)`. For everything else it:
 *  1. resolves the staff session from the cookie (pending, pre-2FA sessions never qualify),
 *  2. checks Origin and the per-session CSRF token on mutations,
 *  3. checks the permission (and data scope when the route names a target),
 *  4. requires a fresh step-up for sensitive permissions.
 * Customers and guests never pass: there is no staff session for them.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly context: RequestContextService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
    private readonly sessions: StaffSessionService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const targets = [executionContext.getHandler(), executionContext.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(PUBLIC_METADATA, targets)) {
      return true;
    }
    const requirement = this.reflector.getAllAndOverride<PermissionRequirement | undefined>(
      PERMISSION_METADATA,
      targets,
    );
    const staffOnly = this.reflector.getAllAndOverride<boolean | undefined>(
      STAFF_ONLY_METADATA,
      targets,
    );
    if (!requirement && !staffOnly) {
      throw new ApiException(
        403,
        'ROUTE_NOT_DECLARED',
        'This route does not declare an access rule',
      );
    }

    const req = executionContext.switchToHttp().getRequest<RequestWithAuth>();
    const session = await this.sessions.authenticate(readStaffToken(req, this.env), {
      verifiedOnly: true,
    });
    if (!session) {
      throw new ApiException(401, 'UNAUTHENTICATED', 'Authentication required');
    }
    assertAllowedOrigin(req, this.env);
    assertCsrf(req, session);
    this.context.setActor({ type: 'staff', id: session.staffUserId });
    req.staffSession = session;
    const grants = await this.authorization.loadGrants(session.staffUserId);
    req.grants = grants;
    if (!requirement) return true;

    const allowed = requirement.target
      ? can(grants, requirement.permission, requirement.target(req))
      : canAnywhere(grants, requirement.permission);
    const route = `${req.method} ${(req.route as { path?: string } | undefined)?.path ?? req.path}`;
    const sensitive = isSensitivePermission(requirement.permission);

    if (!allowed) {
      if (sensitive) {
        await this.audit.recordStandalone({
          action: 'access.denied',
          targetType: 'route',
          targetId: route,
          outcome: 'DENIED',
          after: { permission: requirement.permission },
        });
      }
      throw new ApiException(403, 'FORBIDDEN', 'You do not have permission to perform this action');
    }
    if (sensitive && !(session.stepUpUntil && session.stepUpUntil > new Date())) {
      throw new ApiException(
        403,
        'STEP_UP_REQUIRED',
        'Confirm your two-factor code to perform this action',
      );
    }
    return true;
  }
}
