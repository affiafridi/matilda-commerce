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
import { languageCodeSchema, type z } from '@matilda/validation';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Actor, type AdminActor, uuidPipe } from '../admin/admin-common';
import { RequirePermission } from '../iam/authorization/decorators';
import { AddonsService, putAddonsBody } from './addons.service';
import { BundlesService, putBundleBody } from './bundles.service';
import { OptionsService, putOptionsBody } from './options.service';
import { PricingService, pricePreviewQuery, putPricesBody } from './pricing.service';
import {
  VariationsService,
  bulkUpdateVariationsBody,
  createVariationBody,
  generateVariationsBody,
  productAttributesBody,
  updateVariationBody,
} from './variations.service';
import {
  ProductsService,
  createProductBody,
  productAvailabilityBody,
  productListQuery,
  productTaxonomyBody,
  productTranslationBody,
  updateProductBody,
} from './products.service';

const languagePipe = new ZodValidationPipe(languageCodeSchema);

/**
 * Declared before the taxonomy controller in the module: `products` must not be captured by its
 * `:kind` segment. Route permissions only gate entry; the service re-checks each one over the brand.
 */
@ApiTags('admin-catalog')
@Controller({ path: 'admin/brands/:brandId/catalog/products', version: '1' })
export class AdminProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly variations: VariationsService,
    private readonly pricing: PricingService,
    private readonly options: OptionsService,
    private readonly addons: AddonsService,
    private readonly bundles: BundlesService,
  ) {}

  @Get()
  @RequirePermission('products.view')
  @ApiOperation({ summary: 'List products of a brand (search, status, type, category)' })
  list(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Query(new ZodValidationPipe(productListQuery)) query: z.infer<typeof productListQuery>,
  ) {
    return this.products.list(actor, brandId, query);
  }

  @Post()
  @RequirePermission('products.create')
  @ApiOperation({ summary: 'Create a draft product (English translation required)' })
  create(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Body(new ZodValidationPipe(createProductBody)) body: z.infer<typeof createProductBody>,
  ) {
    return this.products.create(actor, brandId, body);
  }

  @Get(':id')
  @RequirePermission('products.view')
  get(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
  ) {
    return this.products.get(actor, brandId, id);
  }

  @Patch(':id')
  @RequirePermission('products.edit')
  @ApiOperation({
    summary: 'Edit details; setting the publish schedule also needs products.publish',
  })
  update(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(updateProductBody)) body: z.infer<typeof updateProductBody>,
  ) {
    return this.products.update(actor, brandId, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('products.delete')
  @ApiOperation({ summary: 'Delete (soft); frees the SKU and slugs' })
  async remove(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
  ) {
    await this.products.remove(actor, brandId, id);
  }

  @Put(':id/translations/:language')
  @RequirePermission('products.edit')
  putTranslation(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Param('language', languagePipe) language: string,
    @Body(new ZodValidationPipe(productTranslationBody))
    body: z.infer<typeof productTranslationBody>,
  ) {
    return this.products.putTranslation(actor, brandId, id, language, body);
  }

  @Delete(':id/translations/:language')
  @RequirePermission('products.edit')
  deleteTranslation(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Param('language', languagePipe) language: string,
  ) {
    return this.products.deleteTranslation(actor, brandId, id, language);
  }

  @Put(':id/taxonomy')
  @RequirePermission('products.edit')
  @ApiOperation({ summary: 'Replace the categories, collections, tags and primary category' })
  putTaxonomy(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(productTaxonomyBody)) body: z.infer<typeof productTaxonomyBody>,
  ) {
    return this.products.putTaxonomy(actor, brandId, id, body);
  }

  @Put(':id/availability')
  @RequirePermission('products.edit')
  @ApiOperation({ summary: 'Replace the markets and branches the product may be sold in' })
  putAvailability(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(productAvailabilityBody))
    body: z.infer<typeof productAvailabilityBody>,
  ) {
    return this.products.putAvailability(actor, brandId, id, body);
  }

  @Get(':id/attributes')
  @RequirePermission('products.view')
  getAttributes(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
  ) {
    return this.variations.getAttributes(actor, brandId, id);
  }

  @Put(':id/attributes')
  @RequirePermission('products.edit')
  @ApiOperation({ summary: 'Replace the attributes, chosen values and variation-driving flags' })
  putAttributes(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(productAttributesBody)) body: z.infer<typeof productAttributesBody>,
  ) {
    return this.variations.putAttributes(actor, brandId, id, body);
  }

  @Get(':id/variations')
  @RequirePermission('products.view')
  listVariations(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
  ) {
    return this.variations.list(actor, brandId, id);
  }

  @Post(':id/variations/generate')
  @HttpCode(200)
  @RequirePermission('products.edit')
  @ApiOperation({ summary: 'Create every missing combination of the variation attributes' })
  generateVariations(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(generateVariationsBody))
    body: z.infer<typeof generateVariationsBody>,
  ) {
    return this.variations.generate(actor, brandId, id, body);
  }

  @Post(':id/variations')
  @RequirePermission('products.edit')
  createVariation(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(createVariationBody)) body: z.infer<typeof createVariationBody>,
  ) {
    return this.variations.create(actor, brandId, id, body);
  }

  @Patch(':id/variations')
  @RequirePermission('products.edit')
  @ApiOperation({ summary: 'Bulk edit SKU, active flag and order (atomic)' })
  bulkUpdateVariations(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(bulkUpdateVariationsBody))
    body: z.infer<typeof bulkUpdateVariationsBody>,
  ) {
    return this.variations.bulkUpdate(actor, brandId, id, body.items);
  }

  @Patch(':id/variations/:variationId')
  @RequirePermission('products.edit')
  updateVariation(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Param('variationId', uuidPipe) variationId: string,
    @Body(new ZodValidationPipe(updateVariationBody)) body: z.infer<typeof updateVariationBody>,
  ) {
    return this.variations.update(actor, brandId, id, variationId, body);
  }

  @Delete(':id/variations/:variationId')
  @HttpCode(204)
  @RequirePermission('products.edit')
  async removeVariation(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Param('variationId', uuidPipe) variationId: string,
  ) {
    await this.variations.remove(actor, brandId, id, variationId);
  }

  @Get(':id/prices')
  @RequirePermission('products.view')
  listPrices(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
  ) {
    return this.pricing.list(actor, brandId, id);
  }

  @Put(':id/prices')
  @RequirePermission('pricing.edit')
  @ApiOperation({ summary: 'Replace all prices (per market and currency, in minor units)' })
  putPrices(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(putPricesBody)) body: z.infer<typeof putPricesBody>,
  ) {
    return this.pricing.put(actor, brandId, id, body);
  }

  @Delete(':id/prices/:priceId')
  @RequirePermission('pricing.edit')
  deletePrice(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Param('priceId', uuidPipe) priceId: string,
  ) {
    return this.pricing.remove(actor, brandId, id, priceId);
  }

  @Get(':id/price-preview')
  @RequirePermission('products.view')
  @ApiOperation({ summary: 'Read-only: the base price in a market at a moment in time' })
  pricePreview(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Query(new ZodValidationPipe(pricePreviewQuery)) query: z.infer<typeof pricePreviewQuery>,
  ) {
    return this.pricing.preview(actor, brandId, id, query);
  }

  @Get(':id/options')
  @RequirePermission('products.view')
  getOptions(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
  ) {
    return this.options.get(actor, brandId, id);
  }

  @Put(':id/options')
  @RequirePermission('products.edit')
  @ApiOperation({
    summary: 'Replace the customization options (changing option prices also needs pricing.edit)',
  })
  putOptions(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(putOptionsBody)) body: z.infer<typeof putOptionsBody>,
  ) {
    return this.options.put(actor, brandId, id, body);
  }

  @Get(':id/addons')
  @RequirePermission('products.view')
  getAddons(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
  ) {
    return this.addons.get(actor, brandId, id);
  }

  @Put(':id/addons')
  @RequirePermission('products.edit')
  @ApiOperation({
    summary: 'Replace the add-on groups (changing add-on prices also needs pricing.edit)',
  })
  putAddons(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(putAddonsBody)) body: z.infer<typeof putAddonsBody>,
  ) {
    return this.addons.put(actor, brandId, id, body);
  }

  @Get(':id/bundle')
  @RequirePermission('products.view')
  getBundle(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
  ) {
    return this.bundles.get(actor, brandId, id);
  }

  @Put(':id/bundle')
  @RequirePermission('products.edit')
  @ApiOperation({ summary: 'Replace the components of a bundle product' })
  putBundle(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(putBundleBody)) body: z.infer<typeof putBundleBody>,
  ) {
    return this.bundles.put(actor, brandId, id, body);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @RequirePermission('products.publish')
  publish(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
  ) {
    return this.products.setStatus(actor, brandId, id, 'publish');
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  @RequirePermission('products.publish')
  unpublish(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
  ) {
    return this.products.setStatus(actor, brandId, id, 'unpublish');
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermission('products.publish')
  archive(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('id', uuidPipe) id: string,
  ) {
    return this.products.setStatus(actor, brandId, id, 'archive');
  }
}
