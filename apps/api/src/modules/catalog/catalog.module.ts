import { Module } from '@nestjs/common';
import { AddonsService } from './addons.service';
import { BundlesService } from './bundles.service';
import { AttributesService } from './attributes.service';
import { CatalogAccess } from './catalog-common';
import { AdminMediaController, PublicMediaController } from './media/media.controller';
import { PublicCatalogController } from './public/public-catalog.controller';
import { PublicCatalogService } from './public/public-catalog.service';
import { MediaService } from './media/media.service';
import { MEDIA_STORAGE, LocalMediaStorage } from './media/storage';
import { APP_ENV, type Env } from '../../config/env';
import { AdminAttributesController, AdminTaxonomyController } from './catalog.controllers';
import { OptionsService } from './options.service';
import { PricingService } from './pricing.service';
import { AdminProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { TaxonomyService } from './taxonomy.service';
import { VariationsService } from './variations.service';

/**
 * Product and catalog engine (Phase 3, docs/PHASE-3-PLAN.md). Steps 3.3 to 3.10 add taxonomy,
 * attributes, products, variations, pricing, options, add-ons, bundles, media and the public read API. The attribute and product controllers must stay before the taxonomy
 * controller so the taxonomy `:kind` route never captures "attributes".
 */
@Module({
  controllers: [
    AdminAttributesController,
    AdminProductsController,
    AdminMediaController,
    PublicMediaController,
    PublicCatalogController,
    AdminTaxonomyController,
  ],
  providers: [
    CatalogAccess,
    TaxonomyService,
    AttributesService,
    ProductsService,
    VariationsService,
    PricingService,
    OptionsService,
    AddonsService,
    BundlesService,
    MediaService,
    PublicCatalogService,
    {
      provide: MEDIA_STORAGE,
      inject: [APP_ENV],
      useFactory: (env: Env) => new LocalMediaStorage(env.MEDIA_LOCAL_DIR),
    },
  ],
})
export class CatalogModule {}
