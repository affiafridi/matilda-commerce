import { Controller, Get, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { z } from '@matilda/validation';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { PublicRoute } from '../../iam/authorization/decorators';
import type { ResolvedTenant } from '../../tenancy/tenant-resolver.service';
import { TenantGuard } from '../../tenancy/tenant.guard';
import {
  PublicCatalogService,
  publicContextQuery,
  publicProductListQuery,
} from './public-catalog.service';

type TenantRequest = Request & { tenant: ResolvedTenant };

/** Short shared caching: the answer depends on the host (brand, market) and the language query. */
function cacheHeaders(res: Response, language: string): void {
  res.set({
    'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
    Vary: 'Host, X-Forwarded-Host',
    'Content-Language': language,
  });
}

/**
 * Read-only catalog for the storefront. The brand and market come from the request host (never
 * from the client), responses hold only published products sold in that market, and no cost,
 * stock or internal field is exposed.
 */
@ApiTags('catalog')
@PublicRoute()
@UseGuards(TenantGuard)
@Controller({ path: 'catalog', version: '1' })
export class PublicCatalogController {
  constructor(private readonly catalog: PublicCatalogService) {}

  @Get('categories')
  @ApiOperation({ summary: 'Category tree of the brand (published categories)' })
  async categories(
    @Req() req: TenantRequest,
    @Res({ passthrough: true }) res: Response,
    @Query(new ZodValidationPipe(publicContextQuery)) query: z.infer<typeof publicContextQuery>,
  ) {
    const out = await this.catalog.categories(req.tenant, query);
    cacheHeaders(res, out.language);
    return out;
  }

  @Get('collections')
  @ApiOperation({ summary: 'Published collections of the brand' })
  async collections(
    @Req() req: TenantRequest,
    @Res({ passthrough: true }) res: Response,
    @Query(new ZodValidationPipe(publicContextQuery)) query: z.infer<typeof publicContextQuery>,
  ) {
    const out = await this.catalog.collections(req.tenant, query);
    cacheHeaders(res, out.language);
    return out;
  }

  @Get('products')
  @ApiOperation({ summary: 'Products sold in the market (filters, search, sort, paging)' })
  async products(
    @Req() req: TenantRequest,
    @Res({ passthrough: true }) res: Response,
    @Query(new ZodValidationPipe(publicProductListQuery))
    query: z.infer<typeof publicProductListQuery>,
  ) {
    const out = await this.catalog.products(req.tenant, query);
    cacheHeaders(res, out.language);
    return out;
  }

  @Get('products/:slug')
  @ApiOperation({ summary: 'One product by its slug in the response language' })
  async product(
    @Req() req: TenantRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('slug') slug: string,
    @Query(new ZodValidationPipe(publicContextQuery)) query: z.infer<typeof publicContextQuery>,
  ) {
    const out = await this.catalog.product(req.tenant, slug, query);
    cacheHeaders(res, out.language);
    return out;
  }
}
