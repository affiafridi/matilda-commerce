import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { RequestContextService } from '../../common/context/request-context.service';
import { ApiException } from '../../common/errors/api-exception';
import { APP_ENV, type Env } from '../../config/env';
import { requestHost } from './host';
import { TenantResolver } from './tenant-resolver.service';

/**
 * Resolves the brand/market/language of a storefront request from the host and stores them in the
 * request context. Unknown hosts and inactive brands get the same 404 (no enumeration).
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly resolver: TenantResolver,
    private readonly context: RequestContextService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const req = executionContext.switchToHttp().getRequest<Request>();
    const tenant = await this.resolver.resolve(
      requestHost(req.headers, this.env.TRUSTED_PROXY_SECRET),
    );
    if (!tenant) {
      throw new ApiException(404, 'TENANT_NOT_FOUND', 'Unknown storefront');
    }
    this.context.setTenant({
      brand: { id: tenant.brand.id, slug: tenant.brand.slug },
      market: tenant.market ? { id: tenant.market.id, slug: tenant.market.code } : undefined,
      language: tenant.language ?? undefined,
    });
    (req as Request & { tenant?: typeof tenant }).tenant = tenant;
    return true;
  }
}
