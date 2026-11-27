import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from '@matilda/validation';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Actor, type AdminActor, uuidPipe } from '../admin/admin-common';
import { RequirePermission } from '../iam/authorization/decorators';
import {
  CalendarService,
  closureListQuery,
  createClosureBody,
  weeklyHoursBody,
} from './calendar.service';
import {
  AssignmentService,
  assignmentOverrideBody,
  assignmentPreviewBody,
  assignmentRuleListQuery,
  availabilityTestBody,
  putAssignmentRulesBody,
} from './assignment.service';
import { languageParam } from './delivery-common';
import {
  MethodsService,
  chargeListQuery,
  createChargeBody,
  createMethodBody,
  methodListQuery,
  methodTranslationBody,
  updateChargeBody,
  updateMethodBody,
} from './methods.service';

import { SlotsService, createSlotBody, slotListQuery, updateSlotBody } from './slots.service';

import {
  RestrictionsService,
  createRestrictionBody,
  restrictionListQuery,
  updateRestrictionBody,
} from './restrictions.service';

const languagePipe = new ZodValidationPipe(languageParam);

/**
 * Branch calendar. Reads need `delivery.view`, writes `branches.calendar`; the service then checks
 * the permission over the branch (or market, or brand) the record belongs to, so a branch manager
 * can keep their own branch's hours and closed dates and nobody else's.
 */
@ApiTags('admin-delivery')
@Controller({ path: 'admin/brands/:brandId/delivery', version: '1' })
export class AdminCalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get('branches/:branchId/hours')
  @RequirePermission('delivery.view')
  @ApiOperation({ summary: 'Weekly opening hours of a branch for this brand (local time)' })
  getHours(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('branchId', uuidPipe) branchId: string,
  ) {
    return this.calendar.getHours(actor, brandId, branchId);
  }

  @Put('branches/:branchId/hours')
  @RequirePermission('branches.calendar')
  @ApiOperation({ summary: 'Replace the weekly opening hours of a branch' })
  putHours(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('branchId', uuidPipe) branchId: string,
    @Body(new ZodValidationPipe(weeklyHoursBody)) body: z.infer<typeof weeklyHoursBody>,
  ) {
    return this.calendar.putHours(actor, brandId, branchId, body);
  }

  @Get('closures')
  @RequirePermission('delivery.view')
  @ApiOperation({ summary: 'Closed dates of the brand, its markets and branches' })
  listClosures(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Query(new ZodValidationPipe(closureListQuery)) query: z.infer<typeof closureListQuery>,
  ) {
    return this.calendar.list(actor, brandId, query);
  }

  @Post('closures')
  @RequirePermission('branches.calendar')
  @ApiOperation({ summary: 'Close a date for the brand, a market or a branch' })
  createClosure(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Body(new ZodValidationPipe(createClosureBody)) body: z.infer<typeof createClosureBody>,
  ) {
    return this.calendar.create(actor, brandId, body);
  }

  @Delete('closures/:id')
  @HttpCode(204)
  @RequirePermission('branches.calendar')
  async removeClosure(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
  ): Promise<void> {
    await this.calendar.remove(actor, brandId, id);
  }
}

@ApiTags('admin-delivery')
@Controller({ path: 'admin/brands/:brandId/delivery/methods', version: '1' })
export class AdminMethodsController {
  constructor(private readonly methods: MethodsService) {}

  @Get()
  @RequirePermission('delivery.view')
  list(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Query(new ZodValidationPipe(methodListQuery)) query: z.infer<typeof methodListQuery>,
  ) {
    return this.methods.list(actor, brandId, query);
  }

  @Post()
  @RequirePermission('delivery.manage')
  @ApiOperation({ summary: 'Create a delivery method (English name required)' })
  create(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Body(new ZodValidationPipe(createMethodBody)) body: z.infer<typeof createMethodBody>,
  ) {
    return this.methods.create(actor, brandId, body);
  }

  @Get(':id')
  @RequirePermission('delivery.view')
  get(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
  ) {
    return this.methods.get(actor, brandId, id);
  }

  @Patch(':id')
  @RequirePermission('delivery.manage')
  update(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(updateMethodBody)) body: z.infer<typeof updateMethodBody>,
  ) {
    return this.methods.update(actor, brandId, id, body);
  }

  @Put(':id/translations/:language')
  @RequirePermission('delivery.manage')
  putTranslation(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Param('language', languagePipe) language: string,
    @Body(new ZodValidationPipe(methodTranslationBody)) body: z.infer<typeof methodTranslationBody>,
  ) {
    return this.methods.putTranslation(actor, brandId, id, language, body);
  }

  @Delete(':id/translations/:language')
  @RequirePermission('delivery.manage')
  deleteTranslation(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Param('language', languagePipe) language: string,
  ) {
    return this.methods.deleteTranslation(actor, brandId, id, language);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('delivery.manage')
  async remove(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
  ): Promise<void> {
    await this.methods.remove(actor, brandId, id);
  }
}

@ApiTags('admin-delivery')
@Controller({ path: 'admin/brands/:brandId/delivery/charges', version: '1' })
export class AdminChargesController {
  constructor(private readonly methods: MethodsService) {}

  @Get()
  @RequirePermission('delivery.view')
  @ApiOperation({ summary: 'Delivery charges, optionally of one zone or method' })
  list(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Query(new ZodValidationPipe(chargeListQuery)) query: z.infer<typeof chargeListQuery>,
  ) {
    return this.methods.listCharges(actor, brandId, query);
  }

  @Post()
  @RequirePermission('delivery.manage')
  @ApiOperation({ summary: 'Set the fee, minimum order and free threshold of a zone and method' })
  create(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Body(new ZodValidationPipe(createChargeBody)) body: z.infer<typeof createChargeBody>,
  ) {
    return this.methods.createCharge(actor, brandId, body);
  }

  @Patch(':id')
  @RequirePermission('delivery.manage')
  update(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(updateChargeBody)) body: z.infer<typeof updateChargeBody>,
  ) {
    return this.methods.updateCharge(actor, brandId, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('delivery.manage')
  async remove(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
  ): Promise<void> {
    await this.methods.removeCharge(actor, brandId, id);
  }
}

@ApiTags('admin-delivery')
@Controller({ path: 'admin/brands/:brandId/delivery/slots', version: '1' })
export class AdminSlotsController {
  constructor(private readonly slots: SlotsService) {}

  @Get()
  @RequirePermission('delivery.view')
  @ApiOperation({ summary: 'Weekly delivery slots, filtered by market, branch, zone or weekday' })
  list(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Query(new ZodValidationPipe(slotListQuery)) query: z.infer<typeof slotListQuery>,
  ) {
    return this.slots.list(actor, brandId, query);
  }

  @Post()
  @RequirePermission('delivery.manage')
  @ApiOperation({ summary: 'Create a slot with capacity and cutoff (local times)' })
  create(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Body(new ZodValidationPipe(createSlotBody)) body: z.infer<typeof createSlotBody>,
  ) {
    return this.slots.create(actor, brandId, body);
  }

  @Get(':id')
  @RequirePermission('delivery.view')
  get(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
  ) {
    return this.slots.get(actor, brandId, id);
  }

  @Patch(':id')
  @RequirePermission('delivery.manage')
  update(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(updateSlotBody)) body: z.infer<typeof updateSlotBody>,
  ) {
    return this.slots.update(actor, brandId, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('delivery.manage')
  @ApiOperation({ summary: 'Delete a slot with no bookings on record (otherwise set it inactive)' })
  async remove(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
  ): Promise<void> {
    await this.slots.remove(actor, brandId, id);
  }
}

@ApiTags('admin-delivery')
@Controller({ path: 'admin/brands/:brandId/delivery/restrictions', version: '1' })
export class AdminRestrictionsController {
  constructor(private readonly restrictions: RestrictionsService) {}

  @Get()
  @RequirePermission('delivery.view')
  @ApiOperation({ summary: 'Delivery restrictions, filtered by market, target or condition' })
  list(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Query(new ZodValidationPipe(restrictionListQuery))
    query: z.infer<typeof restrictionListQuery>,
  ) {
    return this.restrictions.list(actor, brandId, query);
  }

  @Post()
  @RequirePermission('delivery.manage')
  @ApiOperation({ summary: 'Hold a product, category or collection back under one condition' })
  create(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Body(new ZodValidationPipe(createRestrictionBody))
    body: z.infer<typeof createRestrictionBody>,
  ) {
    return this.restrictions.create(actor, brandId, body);
  }

  @Get(':id')
  @RequirePermission('delivery.view')
  get(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
  ) {
    return this.restrictions.get(actor, brandId, id);
  }

  @Patch(':id')
  @RequirePermission('delivery.manage')
  @ApiOperation({ summary: 'Change the note or status of a restriction' })
  update(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(updateRestrictionBody))
    body: z.infer<typeof updateRestrictionBody>,
  ) {
    return this.restrictions.update(actor, brandId, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('delivery.manage')
  async remove(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
  ): Promise<void> {
    await this.restrictions.remove(actor, brandId, id);
  }
}

/**
 * Branch assignment and the availability tester. Rules are market configuration (changing them
 * needs `delivery.manage`, which asks for step-up); the preview and the tester only read, and a
 * manual branch choice needs `delivery.assign` and is audited.
 */
@ApiTags('admin-delivery')
@Controller({ path: 'admin/brands/:brandId/delivery', version: '1' })
export class AdminAssignmentController {
  constructor(private readonly assignment: AssignmentService) {}

  @Get('assignment-rules')
  @RequirePermission('delivery.view')
  @ApiOperation({ summary: 'Ordered branch assignment rules of a market' })
  rules(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Query(new ZodValidationPipe(assignmentRuleListQuery))
    query: z.infer<typeof assignmentRuleListQuery>,
  ) {
    return this.assignment.listRules(actor, brandId, query.marketId);
  }

  @Put('assignment-rules')
  @RequirePermission('delivery.manage')
  @ApiOperation({ summary: 'Replace the ordered assignment rules of a market' })
  putRules(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Body(new ZodValidationPipe(putAssignmentRulesBody))
    body: z.infer<typeof putAssignmentRulesBody>,
  ) {
    return this.assignment.putRules(actor, brandId, body);
  }

  @Post('availability-test')
  @HttpCode(200)
  @RequirePermission('delivery.view')
  @ApiOperation({ summary: 'Availability tester: dates, slots and serving branches for a cart' })
  test(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Body(new ZodValidationPipe(availabilityTestBody)) body: z.infer<typeof availabilityTestBody>,
  ) {
    return this.assignment.testAvailability(actor, brandId, body);
  }

  @Post('assignment/preview')
  @HttpCode(200)
  @RequirePermission('delivery.view')
  @ApiOperation({ summary: 'Which branch would be chosen, with the ranking and why' })
  preview(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Body(new ZodValidationPipe(assignmentPreviewBody))
    body: z.infer<typeof assignmentPreviewBody>,
  ) {
    return this.assignment.preview(actor, brandId, body);
  }

  @Post('assignment/override')
  @HttpCode(200)
  @RequirePermission('delivery.assign')
  @ApiOperation({ summary: 'Choose a branch by hand; checked against eligibility and audited' })
  override(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Body(new ZodValidationPipe(assignmentOverrideBody))
    body: z.infer<typeof assignmentOverrideBody>,
  ) {
    return this.assignment.override(actor, brandId, body);
  }
}
