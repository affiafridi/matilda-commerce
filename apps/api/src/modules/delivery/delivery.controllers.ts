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
import { languageParam } from './delivery-common';
import {
  LocationsService,
  areaListQuery,
  areaTranslationBody,
  createAreaBody,
  updateAreaBody,
} from './locations.service';
import {
  ZonesService,
  createZoneBody,
  updateZoneBody,
  zoneAreasBody,
  zoneBranchesBody,
  zoneListQuery,
  zoneTranslationBody,
} from './zones.service';

const languagePipe = new ZodValidationPipe(languageParam);

/**
 * Locations are shared reference data: any staff member with `delivery.view` can read them, only
 * platform staff with `delivery.manage` can change them. The service checks scope again.
 */
@ApiTags('admin-delivery')
@Controller({ path: 'admin/delivery/areas', version: '1' })
export class AdminAreasController {
  constructor(private readonly areas: LocationsService) {}

  @Get()
  @RequirePermission('delivery.view')
  @ApiOperation({ summary: 'List locations (emirate, city, area) with their names' })
  list(
    @Actor() actor: AdminActor,
    @Query(new ZodValidationPipe(areaListQuery)) query: z.infer<typeof areaListQuery>,
  ) {
    return this.areas.list(actor, query);
  }

  @Post()
  @RequirePermission('delivery.manage')
  @ApiOperation({ summary: 'Create a location (platform only; English name required)' })
  create(
    @Actor() actor: AdminActor,
    @Body(new ZodValidationPipe(createAreaBody)) body: z.infer<typeof createAreaBody>,
  ) {
    return this.areas.create(actor, body);
  }

  @Get(':id')
  @RequirePermission('delivery.view')
  get(@Actor() actor: AdminActor, @Param('id', uuidPipe) id: string) {
    return this.areas.get(actor, id);
  }

  @Patch(':id')
  @RequirePermission('delivery.manage')
  update(
    @Actor() actor: AdminActor,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(updateAreaBody)) body: z.infer<typeof updateAreaBody>,
  ) {
    return this.areas.update(actor, id, body);
  }

  @Put(':id/translations/:language')
  @RequirePermission('delivery.manage')
  putTranslation(
    @Actor() actor: AdminActor,
    @Param('id', uuidPipe) id: string,
    @Param('language', languagePipe) language: string,
    @Body(new ZodValidationPipe(areaTranslationBody)) body: z.infer<typeof areaTranslationBody>,
  ) {
    return this.areas.putTranslation(actor, id, language, body);
  }

  @Delete(':id/translations/:language')
  @RequirePermission('delivery.manage')
  deleteTranslation(
    @Actor() actor: AdminActor,
    @Param('id', uuidPipe) id: string,
    @Param('language', languagePipe) language: string,
  ) {
    return this.areas.deleteTranslation(actor, id, language);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('delivery.manage')
  @ApiOperation({
    summary: 'Delete a location that has no sub-locations, coverage or restrictions',
  })
  async remove(@Actor() actor: AdminActor, @Param('id', uuidPipe) id: string): Promise<void> {
    await this.areas.remove(actor, id);
  }
}

@ApiTags('admin-delivery')
@Controller({ path: 'admin/brands/:brandId/delivery/zones', version: '1' })
export class AdminZonesController {
  constructor(private readonly zones: ZonesService) {}

  @Get()
  @RequirePermission('delivery.view')
  @ApiOperation({ summary: 'List the delivery zones of a brand, optionally of one market' })
  list(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Query(new ZodValidationPipe(zoneListQuery)) query: z.infer<typeof zoneListQuery>,
  ) {
    return this.zones.list(actor, brandId, query);
  }

  @Post()
  @RequirePermission('delivery.manage')
  @ApiOperation({ summary: 'Create a delivery zone in a market (English name required)' })
  create(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Body(new ZodValidationPipe(createZoneBody)) body: z.infer<typeof createZoneBody>,
  ) {
    return this.zones.create(actor, brandId, body);
  }

  @Get(':id')
  @RequirePermission('delivery.view')
  get(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
  ) {
    return this.zones.get(actor, brandId, id);
  }

  @Patch(':id')
  @RequirePermission('delivery.manage')
  update(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(updateZoneBody)) body: z.infer<typeof updateZoneBody>,
  ) {
    return this.zones.update(actor, brandId, id, body);
  }

  @Put(':id/translations/:language')
  @RequirePermission('delivery.manage')
  putTranslation(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Param('language', languagePipe) language: string,
    @Body(new ZodValidationPipe(zoneTranslationBody)) body: z.infer<typeof zoneTranslationBody>,
  ) {
    return this.zones.putTranslation(actor, brandId, id, language, body);
  }

  @Delete(':id/translations/:language')
  @RequirePermission('delivery.manage')
  deleteTranslation(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Param('language', languagePipe) language: string,
  ) {
    return this.zones.deleteTranslation(actor, brandId, id, language);
  }

  @Put(':id/areas')
  @RequirePermission('delivery.manage')
  @ApiOperation({ summary: 'Replace the locations a zone covers' })
  putAreas(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(zoneAreasBody)) body: z.infer<typeof zoneAreasBody>,
  ) {
    return this.zones.putAreas(actor, brandId, id, body);
  }

  @Put(':id/branches')
  @RequirePermission('delivery.manage')
  @ApiOperation({ summary: 'Replace the branches that serve a zone, with priorities' })
  putBranches(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(zoneBranchesBody)) body: z.infer<typeof zoneBranchesBody>,
  ) {
    return this.zones.putBranches(actor, brandId, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('delivery.manage')
  @ApiOperation({ summary: 'Delete a zone that has no charges, slots or restrictions' })
  async remove(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
  ): Promise<void> {
    await this.zones.remove(actor, brandId, id);
  }
}
