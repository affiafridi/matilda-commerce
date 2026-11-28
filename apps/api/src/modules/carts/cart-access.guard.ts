import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { RequestContextService } from '../../common/context/request-context.service';
import { APP_ENV, type Env } from '../../config/env';
import {
  type RequestWithTenant,
  assertCustomerCsrf,
  assertSameBrandOrigin,
  readCustomerToken,
  requireTenant,
} from '../customer-auth/customer-request-security';
import { CustomerSessionService } from '../customer-auth/customer-session.service';
import { TenantResolver } from '../tenancy/tenant-resolver.service';
import { readCartToken } from './cart-cookie';
import type { CartIdentity } from './carts.service';

export type CartRequest = RequestWithTenant & { cartIdentity?: CartIdentity };

/**
 * Decides who is using the cart (use after `TenantGuard`): a signed-in customer of this brand, or a
 * guest with the secret cart cookie. Mutations must come from a page of the same brand, and a
 * signed-in customer's mutations also need the CSRF token. A guest cookie is SameSite=Lax and
 * carries nothing but a random secret, so the same-brand origin check is its CSRF defence.
 */
@Injectable()
export class CartAccessGuard implements CanActivate {
  constructor(
    private readonly sessions: CustomerSessionService,
    private readonly resolver: TenantResolver,
    private readonly context: RequestContextService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const req = executionContext.switchToHttp().getRequest<CartRequest>();
    const tenant = requireTenant(req);
    await assertSameBrandOrigin(req, this.resolver);
    const session = await this.sessions.authenticate(
      tenant.brand.id,
      readCustomerToken(req, this.env),
    );
    if (session) {
      assertCustomerCsrf(req, session);
      this.context.setActor({ type: 'customer', id: session.customerId });
      req.customerSession = session;
      req.cartIdentity = { customerId: session.customerId };
    } else {
      req.cartIdentity = { guestToken: readCartToken(req, this.env) };
    }
    return true;
  }
}
