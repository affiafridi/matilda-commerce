import { Body, Controller, Get, HttpCode, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { languageCodeSchema, z } from '@matilda/validation';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PublicRoute } from '../iam/authorization/decorators';
import type { ResolvedTenant } from '../tenancy/tenant-resolver.service';
import { TenantGuard } from '../tenancy/tenant.guard';
import {
  AvailabilityService,
  availabilityBody,
  stockStatusBody,
  type AvailabilityResult,
} from './availability.service';

type TenantRequest = Request & { tenant: ResolvedTenant };

const contextQuery = z.object({
  /** Only for brand-wide domains that are not tied to one market. */
  market: z.string().trim().min(1).max(40).optional(),
  language: languageCodeSchema.optional(),
});

/** Availability changes with every order, so it is never cached or shared between shoppers. */
function noStore(res: Response): void {
  res.set({ 'Cache-Control': 'no-store', Vary: 'Host, X-Forwarded-Host' });
}

/** The branch that would serve a slot stays internal; shoppers see dates, times and fees. */
function toPublic(r: AvailabilityResult) {
  return {
    deliverable: r.deliverable,
    reason: r.reason,
    dates: r.dates.map((d) => ({
      date: d.date,
      slots: d.slots.map((s) => ({
        slotId: s.slotId,
        start: s.start,
        end: s.end,
        method: s.method,
        currencyCode: s.currencyCode,
        feeMinor: s.feeMinor,
        minimumOrderMinor: s.minimumOrderMinor,
        freeOverMinor: s.freeOverMinor,
      })),
    })),
  };
}

/**
 * Storefront reads for delivery and stock. The brand and market come from the request host, never
 * from the client; nothing here changes data. Slots are only held later, by the checkout.
 */
@ApiTags('delivery')
@PublicRoute()
@UseGuards(TenantGuard)
@Controller({ path: 'delivery', version: '1' })
export class PublicAvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  private market(req: TenantRequest, code?: string) {
    return this.availability.marketFor(req.tenant.brand.id, req.tenant.market?.id ?? null, code);
  }

  @Get('areas')
  @ApiOperation({ summary: 'Locations the market delivers to, as a flat list with parents' })
  async areas(
    @Req() req: TenantRequest,
    @Res({ passthrough: true }) res: Response,
    @Query(new ZodValidationPipe(contextQuery)) query: z.infer<typeof contextQuery>,
  ) {
    const marketId = await this.market(req, query.market);
    const language = query.language ?? req.tenant.language ?? 'en';
    res.set({
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=120',
      Vary: 'Host, X-Forwarded-Host',
      'Content-Language': language,
    });
    return {
      language,
      items: await this.availability.areas(req.tenant.brand.id, marketId, language),
    };
  }

  @Post('availability')
  @HttpCode(200)
  @ApiOperation({ summary: 'Dates and slots this cart can be delivered to a location' })
  async dates(
    @Req() req: TenantRequest,
    @Res({ passthrough: true }) res: Response,
    @Query(new ZodValidationPipe(contextQuery)) query: z.infer<typeof contextQuery>,
    @Body(new ZodValidationPipe(availabilityBody)) body: z.infer<typeof availabilityBody>,
  ) {
    noStore(res);
    const marketId = await this.market(req, query.market);
    return toPublic(await this.availability.evaluate(req.tenant.brand.id, marketId, body));
  }

  @Post('stock-status')
  @HttpCode(200)
  @ApiOperation({ summary: 'Whether each line is available, low or unavailable (no quantities)' })
  async stock(
    @Req() req: TenantRequest,
    @Res({ passthrough: true }) res: Response,
    @Query(new ZodValidationPipe(contextQuery)) query: z.infer<typeof contextQuery>,
    @Body(new ZodValidationPipe(stockStatusBody)) body: z.infer<typeof stockStatusBody>,
  ) {
    noStore(res);
    const marketId = await this.market(req, query.market);
    return { items: await this.availability.stockStatus(req.tenant.brand.id, marketId, body) };
  }
}
