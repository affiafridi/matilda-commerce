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
  AttributesService,
  attributeListQuery,
  attributeTranslationBody,
  createAttributeBody,
  createValueBody,
  updateAttributeBody,
  updateValueBody,
} from './attributes.service';
import { languageParam, taxonomyTranslationBody } from './catalog-common';
import {
  TaxonomyService,
  createTaxonomyBody,
  taxonomyKindSchema,
  taxonomyListQuery,
  updateTaxonomyBody,
} from './taxonomy.service';

const kindPipe = new ZodValidationPipe(taxonomyKindSchema);
const languagePipe = new ZodValidationPipe(languageParam);

/**
 * Attribute routes are declared before the taxonomy routes in the module: both live under
 * `admin/brands/:brandId/catalog/`, and the taxonomy `:kind` segment must not capture "attributes".
 * The route-level permission only gates entry; every service call checks the permission over the
 * brand in the path again (frontend hiding and coarse guards are not security).
 */
@ApiTags('admin-catalog')
@Controller({ path: 'admin/brands/:brandId/catalog/attributes', version: '1' })
export class AdminAttributesController {
  constructor(private readonly attributes: AttributesService) {}

  @Get()
  @RequirePermission('products.view')
  @ApiOperation({ summary: 'List shared attributes of a brand with their values' })
  list(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Query(new ZodValidationPipe(attributeListQuery)) query: z.infer<typeof attributeListQuery>,
  ) {
    return this.attributes.list(actor, brandId, query);
  }

  @Post()
  @RequirePermission('taxonomy.manage')
  @ApiOperation({ summary: 'Create an attribute (English label required), optionally with values' })
  create(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Body(new ZodValidationPipe(createAttributeBody)) body: z.infer<typeof createAttributeBody>,
  ) {
    return this.attributes.create(actor, brandId, body);
  }

  @Get(':id')
  @RequirePermission('products.view')
  get(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
  ) {
    return this.attributes.get(actor, brandId, id);
  }

  @Patch(':id')
  @RequirePermission('taxonomy.manage')
  @ApiOperation({ summary: 'Change key or type (blocked while products use the attribute)' })
  update(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(updateAttributeBody)) body: z.infer<typeof updateAttributeBody>,
  ) {
    return this.attributes.update(actor, brandId, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('taxonomy.manage')
  @ApiOperation({ summary: 'Delete an attribute (blocked while products use it)' })
  async remove(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
  ) {
    await this.attributes.remove(actor, brandId, id);
  }

  @Put(':id/translations/:language')
  @RequirePermission('taxonomy.manage')
  putTranslation(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Param('language', languagePipe) language: string,
    @Body(new ZodValidationPipe(attributeTranslationBody)) body: { label: string },
  ) {
    return this.attributes.putTranslation(actor, brandId, id, language, body);
  }

  @Delete(':id/translations/:language')
  @RequirePermission('taxonomy.manage')
  deleteTranslation(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Param('language', languagePipe) language: string,
  ) {
    return this.attributes.deleteTranslation(actor, brandId, id, language);
  }

  @Post(':id/values')
  @RequirePermission('taxonomy.manage')
  addValue(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(createValueBody)) body: z.infer<typeof createValueBody>,
  ) {
    return this.attributes.addValue(actor, brandId, id, body);
  }

  @Patch(':id/values/:valueId')
  @RequirePermission('taxonomy.manage')
  updateValue(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Param('valueId', uuidPipe) valueId: string,
    @Body(new ZodValidationPipe(updateValueBody)) body: z.infer<typeof updateValueBody>,
  ) {
    return this.attributes.updateValue(actor, brandId, id, valueId, body);
  }

  @Delete(':id/values/:valueId')
  @RequirePermission('taxonomy.manage')
  removeValue(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Param('valueId', uuidPipe) valueId: string,
  ) {
    return this.attributes.removeValue(actor, brandId, id, valueId);
  }

  @Put(':id/values/:valueId/translations/:language')
  @RequirePermission('taxonomy.manage')
  putValueTranslation(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Param('valueId', uuidPipe) valueId: string,
    @Param('language', languagePipe) language: string,
    @Body(new ZodValidationPipe(attributeTranslationBody)) body: { label: string },
  ) {
    return this.attributes.putValueTranslation(actor, brandId, id, valueId, language, body);
  }

  @Delete(':id/values/:valueId/translations/:language')
  @RequirePermission('taxonomy.manage')
  deleteValueTranslation(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Param('valueId', uuidPipe) valueId: string,
    @Param('language', languagePipe) language: string,
  ) {
    return this.attributes.deleteValueTranslation(actor, brandId, id, valueId, language);
  }
}

/** Categories, collections and tags: `:kind` is categories, collections or tags. */
@ApiTags('admin-catalog')
@Controller({ path: 'admin/brands/:brandId/catalog/:kind', version: '1' })
export class AdminTaxonomyController {
  constructor(private readonly taxonomy: TaxonomyService) {}

  @Get()
  @RequirePermission('products.view')
  @ApiOperation({ summary: 'List categories, collections or tags of a brand' })
  list(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('kind', kindPipe) kind: z.infer<typeof taxonomyKindSchema>,
    @Query(new ZodValidationPipe(taxonomyListQuery)) query: z.infer<typeof taxonomyListQuery>,
  ) {
    return this.taxonomy.list(actor, brandId, kind, query);
  }

  @Post()
  @RequirePermission('taxonomy.manage')
  @ApiOperation({ summary: 'Create one (English translation required; slug defaults to the name)' })
  create(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('kind', kindPipe) kind: z.infer<typeof taxonomyKindSchema>,
    @Body(new ZodValidationPipe(createTaxonomyBody)) body: z.infer<typeof createTaxonomyBody>,
  ) {
    return this.taxonomy.create(actor, brandId, kind, body);
  }

  @Get(':id')
  @RequirePermission('products.view')
  get(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('kind', kindPipe) kind: z.infer<typeof taxonomyKindSchema>,
    @Param('id', uuidPipe) id: string,
  ) {
    return this.taxonomy.get(actor, brandId, kind, id);
  }

  @Patch(':id')
  @RequirePermission('taxonomy.manage')
  @ApiOperation({ summary: 'Change status, order or (categories) parent' })
  update(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('kind', kindPipe) kind: z.infer<typeof taxonomyKindSchema>,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(updateTaxonomyBody)) body: z.infer<typeof updateTaxonomyBody>,
  ) {
    return this.taxonomy.update(actor, brandId, kind, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('taxonomy.manage')
  @ApiOperation({ summary: 'Delete (soft); slugs are retired for redirects and freed for reuse' })
  async remove(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('kind', kindPipe) kind: z.infer<typeof taxonomyKindSchema>,
    @Param('id', uuidPipe) id: string,
  ) {
    await this.taxonomy.remove(actor, brandId, kind, id);
  }

  @Put(':id/translations/:language')
  @RequirePermission('taxonomy.manage')
  putTranslation(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('kind', kindPipe) kind: z.infer<typeof taxonomyKindSchema>,
    @Param('id', uuidPipe) id: string,
    @Param('language', languagePipe) language: string,
    @Body(new ZodValidationPipe(taxonomyTranslationBody))
    body: z.infer<typeof taxonomyTranslationBody>,
  ) {
    return this.taxonomy.putTranslation(actor, brandId, kind, id, language, body);
  }

  @Delete(':id/translations/:language')
  @RequirePermission('taxonomy.manage')
  deleteTranslation(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('kind', kindPipe) kind: z.infer<typeof taxonomyKindSchema>,
    @Param('id', uuidPipe) id: string,
    @Param('language', languagePipe) language: string,
  ) {
    return this.taxonomy.deleteTranslation(actor, brandId, kind, id, language);
  }
}
