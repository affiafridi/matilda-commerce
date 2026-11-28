import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from '@matilda/validation';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Actor, type AdminActor, uuidPipe } from '../admin/admin-common';
import { RequirePermission } from '../iam/authorization/decorators';
import {
  PromotionsService,
  createCouponBody,
  createPromotionBody,
  promotionListQuery,
  updateCouponBody,
  updatePromotionBody,
} from './promotions.service';

/** Staff management of promotions and coupons for one brand (Phase 5 step 5.5). */
@ApiTags('admin-promotions')
@Controller({ path: 'admin/brands/:brandId/promotions', version: '1' })
export class AdminPromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Get()
  @RequirePermission('promotions.view')
  @ApiOperation({ summary: 'Promotions of the brand (priority order, with search and paging)' })
  list(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Query(new ZodValidationPipe(promotionListQuery)) query: z.infer<typeof promotionListQuery>,
  ) {
    return this.promotions.list(actor, brandId, query);
  }

  @Post()
  @RequirePermission('promotions.manage')
  @ApiOperation({ summary: 'Create a promotion (English name required)' })
  create(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Body(new ZodValidationPipe(createPromotionBody)) body: z.infer<typeof createPromotionBody>,
  ) {
    return this.promotions.create(actor, brandId, body);
  }

  @Get(':id')
  @RequirePermission('promotions.view')
  get(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
  ) {
    return this.promotions.get(actor, brandId, id);
  }

  @Patch(':id')
  @RequirePermission('promotions.manage')
  @ApiOperation({
    summary: 'Change a promotion',
    description: 'Markets, targets and names, when sent, replace the stored sets.',
  })
  update(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(updatePromotionBody)) body: z.infer<typeof updatePromotionBody>,
  ) {
    return this.promotions.update(actor, brandId, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('promotions.manage')
  @ApiOperation({ summary: 'Delete a promotion that has no coupons and was never used' })
  async remove(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
  ): Promise<void> {
    await this.promotions.remove(actor, brandId, id);
  }

  @Get(':id/coupons')
  @RequirePermission('promotions.view')
  listCoupons(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
  ) {
    return this.promotions.listCoupons(actor, brandId, id);
  }

  @Post(':id/coupons')
  @RequirePermission('promotions.manage')
  @ApiOperation({ summary: 'Add a coupon code to a promotion' })
  createCoupon(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(createCouponBody)) body: z.infer<typeof createCouponBody>,
  ) {
    return this.promotions.createCoupon(actor, brandId, id, body);
  }

  @Patch(':id/coupons/:couponId')
  @RequirePermission('promotions.manage')
  updateCoupon(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Param('couponId', uuidPipe) couponId: string,
    @Body(new ZodValidationPipe(updateCouponBody)) body: z.infer<typeof updateCouponBody>,
  ) {
    return this.promotions.updateCoupon(actor, brandId, id, couponId, body);
  }

  @Delete(':id/coupons/:couponId')
  @HttpCode(204)
  @RequirePermission('promotions.manage')
  @ApiOperation({ summary: 'Delete a coupon that was never used' })
  async removeCoupon(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Param('couponId', uuidPipe) couponId: string,
  ): Promise<void> {
    await this.promotions.removeCoupon(actor, brandId, id, couponId);
  }
}
