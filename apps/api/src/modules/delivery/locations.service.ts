import { Injectable } from '@nestjs/common';
import { deliveryAreaLevelSchema, z } from '@matilda/validation';
import { ApiException } from '../../common/errors/api-exception';
import { PrismaService } from '../../database/prisma.service';
import { withScope } from '../../database/scope';
import type { Prisma } from '../../generated/prisma/client';
import { type AdminActor, assertCan, assertCanAnywhere, notFound } from '../admin/admin-common';
import { AuditService } from '../audit/audit.service';
import {
  assertTranslationSet,
  codeSchema,
  mapDeliveryError,
  nameTranslationBody,
  nameTranslationWithLanguage,
  REQUIRED_LANGUAGE,
} from './delivery-common';

const statusSchema = z.enum(['ACTIVE', 'INACTIVE']);

export const areaListQuery = z.object({
  countryIso2: z.string().length(2).toUpperCase().optional(),
  parentId: z.string().uuid().optional(),
  level: deliveryAreaLevelSchema.optional(),
});

export const createAreaBody = z.object({
  countryIso2: z.string().length(2).toUpperCase(),
  parentId: z.string().uuid().nullish(),
  level: deliveryAreaLevelSchema,
  code: codeSchema,
  sortOrder: z.number().int().min(0).max(100_000).default(0),
  status: statusSchema.default('ACTIVE'),
  translations: z.array(nameTranslationWithLanguage).min(1).max(20),
});

export const updateAreaBody = z
  .object({
    code: codeSchema,
    sortOrder: z.number().int().min(0).max(100_000),
    status: statusSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Send at least one field to change.');

export { nameTranslationBody as areaTranslationBody };

const INCLUDE = {
  translations: { orderBy: { language: 'asc' } },
  country: { select: { iso2: true } },
} satisfies Prisma.DeliveryAreaInclude;

type AreaRow = Prisma.DeliveryAreaGetPayload<{ include: typeof INCLUDE }>;

const view = (a: AreaRow) => ({
  id: a.id,
  countryIso2: a.country.iso2,
  parentId: a.parentId,
  level: a.level,
  code: a.code,
  sortOrder: a.sortOrder,
  status: a.status,
  translations: a.translations.map((t) => ({ language: t.language, name: t.name })),
});

/**
 * The location tree (emirate, city, area) is shared reference data like countries: no brand owns
 * it, so reads need `delivery.view` anywhere and every write is platform-only (a brand cannot
 * rename or remove a location other brands use). Writes run in platform scope after the check.
 */
@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private readonly platform = { brandIds: [], platform: true } as const;

  private assertPlatform(actor: AdminActor): void {
    assertCan(actor.grants, 'delivery.manage', {});
  }

  async list(actor: AdminActor, query: z.infer<typeof areaListQuery>) {
    assertCanAnywhere(actor.grants, 'delivery.view');
    const rows = await this.prisma.client.deliveryArea.findMany({
      where: {
        ...(query.countryIso2 && { country: { iso2: query.countryIso2 } }),
        ...(query.parentId && { parentId: query.parentId }),
        ...(query.level && { level: query.level }),
      },
      include: INCLUDE,
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    return rows.map(view);
  }

  async get(actor: AdminActor, id: string) {
    assertCanAnywhere(actor.grants, 'delivery.view');
    return view(await this.load(id));
  }

  private async load(id: string, db: Prisma.TransactionClient = this.prisma.client) {
    const row = await db.deliveryArea.findUnique({ where: { id }, include: INCLUDE });
    if (!row) throw notFound('Area');
    return row;
  }

  async create(actor: AdminActor, input: z.infer<typeof createAreaBody>) {
    this.assertPlatform(actor);
    assertTranslationSet(input.translations.map((t) => t.language));
    const country = await this.prisma.client.country.findUnique({
      where: { iso2: input.countryIso2 },
    });
    if (!country) throw new ApiException(422, 'UNKNOWN_COUNTRY', 'Unknown country');
    if (input.parentId) {
      const parent = await this.prisma.client.deliveryArea.findFirst({
        where: { id: input.parentId, countryId: country.id },
      });
      if (!parent)
        throw new ApiException(422, 'PARENT_NOT_FOUND', 'The parent is not in this country');
    }
    try {
      return await withScope(this.prisma.client, this.platform, async (tx) => {
        const row = await tx.deliveryArea.create({
          data: {
            countryId: country.id,
            parentId: input.parentId ?? null,
            level: input.level,
            code: input.code,
            sortOrder: input.sortOrder,
            status: input.status,
            translations: { create: input.translations },
          },
          include: INCLUDE,
        });
        await this.audit.record(tx, {
          action: 'delivery.area.create',
          targetType: 'delivery_area',
          targetId: row.id,
          actor: { type: 'STAFF', id: actor.staffId },
          after: view(row),
        });
        return view(row);
      });
    } catch (err) {
      throw mapDeliveryError(err, 'AREA_CODE_TAKEN', 'That code is already used in this country');
    }
  }

  async update(actor: AdminActor, id: string, patch: z.infer<typeof updateAreaBody>) {
    this.assertPlatform(actor);
    const before = view(await this.load(id));
    try {
      return await withScope(this.prisma.client, this.platform, async (tx) => {
        await tx.deliveryArea.update({ where: { id }, data: patch });
        const after = view(await this.load(id, tx));
        await this.audit.record(tx, {
          action: 'delivery.area.update',
          targetType: 'delivery_area',
          targetId: id,
          actor: { type: 'STAFF', id: actor.staffId },
          before,
          after,
        });
        return after;
      });
    } catch (err) {
      throw mapDeliveryError(err, 'AREA_CODE_TAKEN', 'That code is already used in this country');
    }
  }

  async putTranslation(
    actor: AdminActor,
    id: string,
    language: string,
    body: z.infer<typeof nameTranslationBody>,
  ) {
    this.assertPlatform(actor);
    await this.load(id);
    return withScope(this.prisma.client, this.platform, async (tx) => {
      await tx.deliveryAreaTranslation.upsert({
        where: { areaId_language: { areaId: id, language } },
        create: { areaId: id, language, name: body.name },
        update: { name: body.name },
      });
      await this.audit.record(tx, {
        action: 'delivery.area.translation.put',
        targetType: 'delivery_area',
        targetId: id,
        actor: { type: 'STAFF', id: actor.staffId },
        after: { language, name: body.name },
      });
      return view(await this.load(id, tx));
    });
  }

  async deleteTranslation(actor: AdminActor, id: string, language: string) {
    this.assertPlatform(actor);
    if (language === REQUIRED_LANGUAGE) {
      throw new ApiException(422, 'ENGLISH_REQUIRED', 'The English name cannot be removed');
    }
    const area = await this.load(id);
    if (!area.translations.some((t) => t.language === language)) throw notFound('Translation');
    return withScope(this.prisma.client, this.platform, async (tx) => {
      await tx.deliveryAreaTranslation.delete({
        where: { areaId_language: { areaId: id, language } },
      });
      await this.audit.record(tx, {
        action: 'delivery.area.translation.delete',
        targetType: 'delivery_area',
        targetId: id,
        actor: { type: 'STAFF', id: actor.staffId },
        before: { language },
      });
      return view(await this.load(id, tx));
    });
  }

  async remove(actor: AdminActor, id: string): Promise<void> {
    this.assertPlatform(actor);
    const area = await this.load(id);
    await withScope(this.prisma.client, this.platform, async (tx) => {
      const [children, zones, restrictions] = await Promise.all([
        tx.deliveryArea.count({ where: { parentId: id } }),
        tx.deliveryZoneArea.count({ where: { areaId: id } }),
        tx.deliveryRestriction.count({ where: { areaId: id } }),
      ]);
      if (children + zones + restrictions > 0) {
        throw new ApiException(
          409,
          'AREA_IN_USE',
          'The location has sub-locations, zone coverage or restrictions; remove those first',
        );
      }
      await tx.deliveryArea.delete({ where: { id } });
      await this.audit.record(tx, {
        action: 'delivery.area.delete',
        targetType: 'delivery_area',
        targetId: id,
        actor: { type: 'STAFF', id: actor.staffId },
        before: view(area),
      });
    });
  }
}
