import { Controller, Get, Header, Req, UseGuards } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { StorefrontContext } from '@matilda/types';
import { PublicRoute } from '../iam/authorization/decorators';
import { StorefrontContextService } from './storefront-context.service';
import type { ResolvedTenant } from './tenant-resolver.service';
import { TenantGuard } from './tenant.guard';

@PublicRoute()
@ApiTags('storefront')
@Controller({ path: 'storefront', version: '1' })
@UseGuards(TenantGuard)
export class StorefrontController {
  constructor(private readonly contextService: StorefrontContextService) {}

  @Get('context')
  @Header('Cache-Control', 'no-store')
  @Header('Vary', 'Host, X-Forwarded-Host')
  @ApiOperation({
    summary: 'Public configuration of the brand serving this host',
    description:
      'The brand is resolved from the request host only (never from headers or query parameters). ' +
      'Unknown hosts and inactive brands return 404. Contains no secrets and no other brand data.',
  })
  @ApiOkResponse({ description: 'Brand, current market, available markets, language, redirect.' })
  @ApiNotFoundResponse({ description: 'TENANT_NOT_FOUND' })
  context(@Req() req: Request & { tenant: ResolvedTenant }): Promise<StorefrontContext> {
    return this.contextService.load(req.tenant);
  }
}
