import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { z } from '@matilda/validation';
import { ApiException } from '../../../common/errors/api-exception';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { Actor, type AdminActor, notFound, uuidPipe } from '../../admin/admin-common';
import { PublicRoute, RequirePermission } from '../../iam/authorization/decorators';
import { VARIANT_WIDTHS, type VariantKind } from './image';
import {
  MediaService,
  mediaListQuery,
  putAltBody,
  putGalleryBody,
  putVariationImageBody,
} from './media.service';

interface UploadedImage {
  buffer: Buffer;
  originalname: string;
}

/** Hard ceiling for the multipart parser; the configured limit is enforced by the service. */
const PARSER_LIMIT = 52_428_800;

/** Declared before the taxonomy controller in the module so its `:kind` route never captures `media`. */
@ApiTags('admin-catalog')
@Controller({ path: 'admin/brands/:brandId/catalog', version: '1' })
export class AdminMediaController {
  constructor(private readonly media: MediaService) {}

  @Post('media')
  @RequirePermission('media.manage')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a picture (JPEG, PNG or WebP); fields: file, altText (English)',
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: PARSER_LIMIT, files: 1 } }))
  upload(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @UploadedFile() file: UploadedImage | undefined,
    @Body() body: { altText?: unknown } | undefined,
  ) {
    const altText = typeof body?.altText === 'string' ? body.altText : undefined;
    return this.media.upload(actor, brandId, file, altText);
  }

  @Get('media')
  @RequirePermission('media.manage')
  @ApiOperation({ summary: 'List the pictures of the brand library' })
  list(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Query(new ZodValidationPipe(mediaListQuery)) query: z.infer<typeof mediaListQuery>,
  ) {
    return this.media.list(actor, brandId, query);
  }

  @Get('media/:assetId')
  @RequirePermission('media.manage')
  @ApiOperation({ summary: 'Get one picture' })
  get(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('assetId', uuidPipe) assetId: string,
  ) {
    return this.media.get(actor, brandId, assetId);
  }

  @Put('media/:assetId/alt')
  @RequirePermission('media.manage')
  @ApiOperation({ summary: 'Replace the alt text of a picture (English required)' })
  putAlt(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('assetId', uuidPipe) assetId: string,
    @Body(new ZodValidationPipe(putAltBody)) body: z.infer<typeof putAltBody>,
  ) {
    return this.media.putAlt(actor, brandId, assetId, body);
  }

  @Delete('media/:assetId')
  @HttpCode(204)
  @RequirePermission('media.manage')
  @ApiOperation({ summary: 'Delete a picture that no product, variation or category uses' })
  remove(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('assetId', uuidPipe) assetId: string,
  ) {
    return this.media.remove(actor, brandId, assetId);
  }

  @Get('products/:productId/media')
  @RequirePermission('media.manage')
  @ApiOperation({ summary: 'Gallery of a product' })
  getGallery(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('productId', uuidPipe) productId: string,
  ) {
    return this.media.getGallery(actor, brandId, productId);
  }

  @Put('products/:productId/media')
  @RequirePermission('media.manage')
  @ApiOperation({ summary: 'Replace the gallery of a product (order is the display order)' })
  putGallery(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('productId', uuidPipe) productId: string,
    @Body(new ZodValidationPipe(putGalleryBody)) body: z.infer<typeof putGalleryBody>,
  ) {
    return this.media.putGallery(actor, brandId, productId, body);
  }

  @Put('products/:productId/variations/:variationId/media')
  @RequirePermission('media.manage')
  @ApiOperation({ summary: 'Set or clear the picture of a variation' })
  putVariationImage(
    @Actor() actor: AdminActor,
    @Param('brandId', uuidPipe) brandId: string,
    @Param('productId', uuidPipe) productId: string,
    @Param('variationId', uuidPipe) variationId: string,
    @Body(new ZodValidationPipe(putVariationImageBody))
    body: z.infer<typeof putVariationImageBody>,
  ) {
    return this.media.putVariationImage(actor, brandId, productId, variationId, body);
  }
}

/**
 * Public delivery of processed pictures. Identifiers are unguessable and only the resized WebP
 * variants are served (never the original upload). Browsers and the CDN may cache them for a year
 * because a changed picture is a new asset.
 */
@ApiTags('media')
@PublicRoute()
@Controller({ path: 'media', version: '1' })
export class PublicMediaController {
  constructor(private readonly media: MediaService) {}

  @Get(':brandId/:assetId/:kind')
  @ApiOperation({ summary: 'Download a picture variant (thumbnail, medium or large)' })
  async serve(
    @Param('brandId', uuidPipe) brandId: string,
    @Param('assetId', uuidPipe) assetId: string,
    @Param('kind') kind: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const upper = kind.toUpperCase();
    if (!(upper in VARIANT_WIDTHS)) throw new ApiException(404, 'NOT_FOUND', 'Not found');
    const found = await this.media.readVariant(brandId, assetId, upper as VariantKind);
    if (!found) throw notFound('Media');
    res.set({
      'Content-Type': found.contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    return new StreamableFile(found.data);
  }
}
