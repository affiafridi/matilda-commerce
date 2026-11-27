import { Injectable } from '@nestjs/common';
import { z } from '@matilda/validation';
import { ApiException } from '../../common/errors/api-exception';
import type { Prisma } from '../../generated/prisma/client';
import { notFound, type AdminActor } from '../admin/admin-common';
import {
  assertTranslationSet,
  codeSchema,
  DeliveryAccess,
  mapDeliveryError,
  nameTranslationBody,
  nameTranslationWithLanguage,
  REQUIRED_LANGUAGE,
} from './delivery-common';

type Tx = Prisma.TransactionClient;

const statusSchema = z.enum(['ACTIVE', 'INACTIVE']);

export const zoneListQuery = z.object({ marketId: z.string().uuid().optional() });

export const createZoneBody = z.object({
  marketId: z.string().uuid(),
  code: codeSchema,
  sortOrder: z.number().int().min(0).max(100_000).default(0),
  status: statusSchema.default('ACTIVE'),
  translations: z.array(nameTranslationWithLanguage).min(1).max(20),
});

export const updateZoneBody = z
  .object({
    code: codeSchema,
    sortOrder: z.number().int().min(0).max(100_000),
    status: statusSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Send at least one field to change.');

export const zoneAreasBody = z.object({ areaIds: z.array(z.string().uuid()).max(2000) });

export const zoneBranchesBody = z.object({
  branches: z
    .array(
      z.object({
        branchId: z.string().uuid(),
        /** Lower number is tried first when several branches can serve the zone. */
        priority: z.number().int().min(0).max(1000).default(0),
      }),
    )
    .max(100),
});

export { nameTranslationBody as zoneTranslationBody };

const INCLUDE = {
  translations: { orderBy: { language: 'asc' } },
  areas: { select: { areaId: true } },
  branchLinks: { select: { branchId: true, priority: true }, orderBy: { priority: 'asc' } },
} satisfies Prisma.DeliveryZoneInclude;

type ZoneRow = Prisma.DeliveryZoneGetPayload<{ include: typeof INCLUDE }>;

const view = (z: ZoneRow) => ({
  id: z.id,
  marketId: z.marketId,
  code: z.code,
  sortOrder: z.sortOrder,
  status: z.status,
  translations: z.translations.map((t) => ({ language: t.language, name: t.name })),
  areaIds: z.areas.map((a) => a.areaId).sort(),
  branches: z.branchLinks.map((b) => ({ branchId: b.branchId, priority: b.priority })),
});

/**
 * Delivery zones of a brand: named groups of locations inside one market, served by one or more
 * branches. Charges, slots and restrictions (steps 4.4 to 4.6) hang off a zone. Reads need
 * `delivery.view`, writes `delivery.manage`, both over the brand in the path; the database adds
 * row-level security, the market-country check on coverage and the branch-serves-brand check.
 */
@Injectable()
export class ZonesService {
  constructor(private readonly access: DeliveryAccess) {}

  list(actor: AdminActor, brandId: string, query: z.infer<typeof zoneListQuery>) {
    return this.access.run(actor, brandId, 'delivery.view', async (tx) => {
      const rows = await tx.deliveryZone.findMany({
        where: query.marketId ? { marketId: query.marketId } : {},
        include: INCLUDE,
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      });
      return rows.map(view);
    });
  }

  get(actor: AdminActor, brandId: string, id: string) {
    return this.access.run(actor, brandId, 'delivery.view', async (tx) =>
      view(await this.load(tx, id)),
    );
  }

  private async load(tx: Tx, id: string): Promise<ZoneRow> {
    const row = await tx.deliveryZone.findFirst({ where: { id }, include: INCLUDE });
    if (!row) throw notFound('Zone');
    return row;
  }

  async create(actor: AdminActor, brandId: string, input: z.infer<typeof createZoneBody>) {
    assertTranslationSet(input.translations.map((t) => t.language));
    try {
      return await this.access.run(actor, brandId, 'delivery.manage', async (tx) => {
        const market = await tx.market.findFirst({ where: { id: input.marketId, brandId } });
        if (!market) throw notFound('Market');
        const created = await tx.deliveryZone.create({
          data: {
            brandId,
            marketId: input.marketId,
            code: input.code,
            sortOrder: input.sortOrder,
            status: input.status,
          },
        });
        await tx.deliveryZoneTranslation.createMany({
          data: input.translations.map((t) => ({ zoneId: created.id, brandId, ...t })),
        });
        const row = await this.load(tx, created.id);
        await this.access.record(
          tx,
          actor,
          brandId,
          'delivery.zone.create',
          'delivery_zone',
          row.id,
          undefined,
          view(row),
        );
        return view(row);
      });
    } catch (err) {
      throw mapDeliveryError(err, 'ZONE_CODE_TAKEN', 'That code is already used in this market');
    }
  }

  async update(
    actor: AdminActor,
    brandId: string,
    id: string,
    patch: z.infer<typeof updateZoneBody>,
  ) {
    try {
      return await this.access.run(actor, brandId, 'delivery.manage', async (tx) => {
        const before = view(await this.load(tx, id));
        await tx.deliveryZone.update({ where: { id }, data: patch });
        const after = view(await this.load(tx, id));
        await this.access.record(
          tx,
          actor,
          brandId,
          'delivery.zone.update',
          'delivery_zone',
          id,
          before,
          after,
        );
        return after;
      });
    } catch (err) {
      throw mapDeliveryError(err, 'ZONE_CODE_TAKEN', 'That code is already used in this market');
    }
  }

  putTranslation(
    actor: AdminActor,
    brandId: string,
    id: string,
    language: string,
    body: z.infer<typeof nameTranslationBody>,
  ) {
    return this.access.run(actor, brandId, 'delivery.manage', async (tx) => {
      await this.load(tx, id);
      await tx.deliveryZoneTranslation.upsert({
        where: { zoneId_language: { zoneId: id, language } },
        create: { zoneId: id, brandId, language, name: body.name },
        update: { name: body.name },
      });
      await this.access.record(
        tx,
        actor,
        brandId,
        'delivery.zone.translation.put',
        'delivery_zone',
        id,
        undefined,
        { language, name: body.name },
      );
      return view(await this.load(tx, id));
    });
  }

  deleteTranslation(actor: AdminActor, brandId: string, id: string, language: string) {
    if (language === REQUIRED_LANGUAGE) {
      throw new ApiException(422, 'ENGLISH_REQUIRED', 'The English name cannot be removed');
    }
    return this.access.run(actor, brandId, 'delivery.manage', async (tx) => {
      const zone = await this.load(tx, id);
      if (!zone.translations.some((t) => t.language === language)) throw notFound('Translation');
      await tx.deliveryZoneTranslation.delete({
        where: { zoneId_language: { zoneId: id, language } },
      });
      await this.access.record(
        tx,
        actor,
        brandId,
        'delivery.zone.translation.delete',
        'delivery_zone',
        id,
        { language },
      );
      return view(await this.load(tx, id));
    });
  }

  /** Replaces the locations the zone covers. A location can be in one zone per market. */
  async putAreas(
    actor: AdminActor,
    brandId: string,
    id: string,
    body: z.infer<typeof zoneAreasBody>,
  ) {
    const areaIds = [...new Set(body.areaIds)];
    try {
      return await this.access.run(actor, brandId, 'delivery.manage', async (tx) => {
        const zone = await this.load(tx, id);
        if ((await tx.deliveryArea.count({ where: { id: { in: areaIds } } })) !== areaIds.length) {
          throw new ApiException(422, 'AREA_NOT_FOUND', 'One or more locations do not exist');
        }
        await tx.deliveryZoneArea.deleteMany({ where: { zoneId: id } });
        await tx.deliveryZoneArea.createMany({
          data: areaIds.map((areaId) => ({ zoneId: id, brandId, marketId: zone.marketId, areaId })),
        });
        const after = view(await this.load(tx, id));
        await this.access.record(
          tx,
          actor,
          brandId,
          'delivery.zone.areas.put',
          'delivery_zone',
          id,
          { areaIds: view(zone).areaIds },
          { areaIds: after.areaIds },
        );
        return after;
      });
    } catch (err) {
      throw mapDeliveryError(
        err,
        'AREA_ALREADY_COVERED',
        'A location is already covered by another zone of this market',
      );
    }
  }

  /** Replaces the branches that serve the zone, with their priority. */
  async putBranches(
    actor: AdminActor,
    brandId: string,
    id: string,
    body: z.infer<typeof zoneBranchesBody>,
  ) {
    const ids = body.branches.map((b) => b.branchId);
    if (new Set(ids).size !== ids.length) {
      throw new ApiException(422, 'DUPLICATE_BRANCH', 'Each branch can appear only once');
    }
    try {
      return await this.access.run(actor, brandId, 'delivery.manage', async (tx) => {
        const zone = await this.load(tx, id);
        if ((await tx.branch.count({ where: { id: { in: ids } } })) !== ids.length) {
          throw new ApiException(422, 'BRANCH_NOT_FOUND', 'One or more branches do not exist');
        }
        await tx.branchZone.deleteMany({ where: { zoneId: id } });
        await tx.branchZone.createMany({
          data: body.branches.map((b) => ({
            zoneId: id,
            brandId,
            branchId: b.branchId,
            priority: b.priority,
          })),
        });
        const after = view(await this.load(tx, id));
        await this.access.record(
          tx,
          actor,
          brandId,
          'delivery.zone.branches.put',
          'delivery_zone',
          id,
          { branches: view(zone).branches },
          { branches: after.branches },
        );
        return after;
      });
    } catch (err) {
      throw mapDeliveryError(err);
    }
  }

  remove(actor: AdminActor, brandId: string, id: string): Promise<void> {
    return this.access.run(actor, brandId, 'delivery.manage', async (tx) => {
      const zone = await this.load(tx, id);
      const [charges, slots, restrictions] = await Promise.all([
        tx.zoneCharge.count({ where: { zoneId: id } }),
        tx.deliverySlot.count({ where: { zoneId: id } }),
        tx.deliveryRestriction.count({ where: { zoneId: id } }),
      ]);
      if (charges + slots + restrictions > 0) {
        throw new ApiException(
          409,
          'ZONE_IN_USE',
          'The zone has charges, slots or restrictions; remove those first',
        );
      }
      await tx.deliveryZone.delete({ where: { id } });
      await this.access.record(
        tx,
        actor,
        brandId,
        'delivery.zone.delete',
        'delivery_zone',
        id,
        view(zone),
      );
    });
  }
}
