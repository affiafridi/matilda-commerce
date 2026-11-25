import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { RequestContextService } from '../../common/context/request-context.service';
import { ApiException } from '../../common/errors/api-exception';
import { APP_ENV, type Env } from '../../config/env';
import { TenantResolver } from '../tenancy/tenant-resolver.service';
import {
  type RequestWithTenant,
  assertCustomerCsrf,
  assertSameBrandOrigin,
  readCustomerToken,
  requireTenant,
} from './customer-request-security';
import { CustomerSessionService } from './customer-session.service';

/**
 * Authenticates a customer session for the brand the host resolved to (use after `TenantGuard`).
 * Only the customer cookie is read: staff cookies and guests never pass, and a customer cookie is
 * meaningless on every other brand. Mutations also need a same-brand Origin and the CSRF token.
 */
@Injectable()
export class CustomerSessionGuard implements CanActivate {
  constructor(
    private readonly sessions: CustomerSessionService,
    private readonly resolver: TenantResolver,
    private readonly context: RequestContextService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const req = executionContext.switchToHttp().getRequest<RequestWithTenant>();
    const tenant = requireTenant(req);
    const session = await this.sessions.authenticate(
      tenant.brand.id,
      readCustomerToken(req, this.env),
    );
    if (!session) throw new ApiException(401, 'UNAUTHENTICATED', 'Authentication required');
    await assertSameBrandOrigin(req, this.resolver);
    assertCustomerCsrf(req, session);
    this.context.setActor({ type: 'customer', id: session.customerId });
    req.customerSession = session;
    return true;
  }
}
