import { Injectable } from '@nestjs/common';
import { z } from '@matilda/validation';
import { ApiException } from '../../common/errors/api-exception';
import { PrismaService } from '../../database/prisma.service';
import { withScope } from '../../database/scope';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../iam/authorization/authorization.service';
import { type AdminActor, assertCan, isUniqueViolation, notFound, visibleTo } from './admin-common';

const text = (max: number) => z.string().trim().max(max);
const fields = {
  name: text(160).min(1),
  addressLine1: text(200).nullable(),
  addressLine2: text(200).nullable(),
  city: text(100).nullable(),
  area: text(100).nullable(),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  phone: text(40).nullable(),
  email: z.string().trim().toLowerCase().email().max(254).nullable(),
  timezone: z.string().min(3).max(64),
  status: z.enum(['ACTIVE', 'INACTIVE']),
};

export const createBranchBody = z.object({
  code: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .max(40),
  countryIso2: z.string().length(2).toUpperCase(),
  marketIds: z.array(z.string().uuid()).min(1).max(20),
  ...z.object(fields).partial({
    addressLine1: true,
    addressLine2: true,
    city: true,
    area: true,
    latitude: true,
    longitude: true,
    phone: true,
    email: true,
    status: true,
  }).shape,
});
export const updateBranchBody = z.object(fields).partial();

type CreateBranch = z.infer<typeof createBranchBody>;
type UpdateBranch = z.infer<typeof updateBranchBody>;

const INCLUDE = {
  country: { select: { iso2: true, name: true } },
  markets: { select: { marketId: true, status: true, market: { select: { brandId: true } } } },
} satisfies Prisma.BranchInclude;

/**
 * Branches are shared across the markets of one country. Row-level security makes branch writes
 * platform-only, so the application authorizes first (permission over every affected market) and
 * then writes in platform scope. Editing a branch needs the permission over ALL markets it serves,
 * because the change is visible to each of them.
 */
@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authz: AuthorizationService,
  ) {}

  async list(actor: AdminActor) {
    const scope = await this.authz.dbScopeFor(actor.grants, 'branches.view');
    const rows = await withScope(this.prisma.client, scope, (tx) =>
      tx.branch.findMany({ include: INCLUDE, orderBy: { code: 'asc' } }),
    );
    return visibleTo(actor.grants, 'branches.view', rows, (b) =>
      b.markets.map((m) => ({ brandId: m.market.brandId, marketId: m.marketId, branchId: b.id })),
    );
  }

  async get(actor: AdminActor, id: string) {
    const branch = (await this.list(actor)).find((b) => b.id === id);
    if (!branch) throw notFound('Branch');
    return branch;
  }

  async create(actor: AdminActor, input: CreateBranch) {
    const { marketIds, countryIso2, ...data } = input;
    const platform = { brandIds: [], platform: true } as const;
    const [country, markets] = await Promise.all([
      this.prisma.client.country.findUnique({ where: { iso2: countryIso2 } }),
      withScope(this.prisma.client, platform, (tx) =>
        tx.market.findMany({ where: { id: { in: marketIds } } }),
      ),
    ]);
    if (!country) throw new ApiException(422, 'UNKNOWN_COUNTRY', 'Unknown country');
    if (markets.length !== new Set(marketIds).size) throw notFound('Market');
    for (const m of markets) {
      assertCan(actor.grants, 'branches.manage', { brandId: m.brandId, marketId: m.id });
      if (m.countryId !== country.id) {
        throw new ApiException(
          422,
          'COUNTRY_MISMATCH',
          'A branch can only serve markets of its country',
        );
      }
    }
    try {
      return await withScope(this.prisma.client, platform, async (tx) => {
        const branch = await tx.branch.create({
          data: {
            ...data,
            countryId: country.id,
            markets: {
              create: [...new Set(marketIds)].map((marketId) => ({ marketId })),
            },
          },
          include: INCLUDE,
        });
        await this.audit.record(tx, {
          action: 'branch.create',
          targetType: 'branch',
          targetId: branch.id,
          actor: { type: 'STAFF', id: actor.staffId },
          branchId: branch.id,
          after: { ...input },
        });
        return branch;
      });
    } catch (err) {
      throw this.writeError(err);
    }
  }

  async update(actor: AdminActor, id: string, patch: UpdateBranch) {
    const current = await this.get(actor, id);
    await this.assertManagesAll(actor, id);
    const { latitude, longitude, ...rest } = patch;
    return withScope(this.prisma.client, { brandIds: [], platform: true }, async (tx) => {
      const branch = await tx.branch.update({
        where: { id },
        data: { ...rest, latitude, longitude },
        include: INCLUDE,
      });
      await this.audit.record(tx, {
        action: 'branch.update',
        targetType: 'branch',
        targetId: id,
        actor: { type: 'STAFF', id: actor.staffId },
        branchId: id,
        before: { name: current.name, status: current.status, timezone: current.timezone },
        after: patch,
      });
      return branch;
    });
  }

  async linkMarket(actor: AdminActor, branchId: string, marketId: string) {
    const current = await this.get(actor, branchId);
    const platform = { brandIds: [], platform: true } as const;
    const market = await withScope(this.prisma.client, platform, (tx) =>
      tx.market.findUnique({ where: { id: marketId } }),
    );
    if (!market) throw notFound('Market');
    assertCan(actor.grants, 'branches.manage', { brandId: market.brandId, marketId });
    if (market.countryId !== current.countryId) {
      throw new ApiException(
        422,
        'COUNTRY_MISMATCH',
        'A branch can only serve markets of its country',
      );
    }
    try {
      await withScope(this.prisma.client, platform, async (tx) => {
        await tx.branchMarket.create({
          data: { branchId, marketId, countryId: current.countryId },
        });
        await this.audit.record(tx, {
          action: 'branch.market.link',
          targetType: 'branch',
          targetId: branchId,
          actor: { type: 'STAFF', id: actor.staffId },
          brandId: market.brandId,
          marketId,
          branchId,
        });
      });
    } catch (err) {
      throw this.writeError(err);
    }
    return this.get(actor, branchId);
  }

  async unlinkMarket(actor: AdminActor, branchId: string, marketId: string): Promise<void> {
    const current = await this.get(actor, branchId);
    const link = current.markets.find((m) => m.marketId === marketId);
    if (!link) throw notFound('Market link');
    assertCan(actor.grants, 'branches.manage', { brandId: link.market.brandId, marketId });
    if ((await this.allLinks(branchId)).length === 1) {
      throw new ApiException(409, 'LAST_MARKET_LINK', 'A branch must serve at least one market');
    }
    await withScope(this.prisma.client, { brandIds: [], platform: true }, async (tx) => {
      await tx.branchMarket.delete({ where: { branchId_marketId: { branchId, marketId } } });
      await this.audit.record(tx, {
        action: 'branch.market.unlink',
        targetType: 'branch',
        targetId: branchId,
        actor: { type: 'STAFF', id: actor.staffId },
        brandId: link.market.brandId,
        marketId,
        branchId,
      });
    });
  }

  /** Every market link, including those of brands the actor cannot see (row-level security hides them). */
  private allLinks(branchId: string) {
    return withScope(this.prisma.client, { brandIds: [], platform: true }, (tx) =>
      tx.branchMarket.findMany({
        where: { branchId },
        select: { marketId: true, market: { select: { brandId: true } } },
      }),
    );
  }

  private async assertManagesAll(actor: AdminActor, branchId: string): Promise<void> {
    const links = await this.allLinks(branchId);
    if (links.length === 0) {
      assertCan(actor.grants, 'branches.manage', {});
      return;
    }
    for (const m of links) {
      assertCan(actor.grants, 'branches.manage', {
        brandId: m.market.brandId,
        marketId: m.marketId,
        branchId,
      });
    }
  }

  private writeError(err: unknown): unknown {
    if (err instanceof ApiException) return err;
    if (isUniqueViolation(err)) {
      return new ApiException(
        409,
        'BRANCH_EXISTS',
        'A branch with this code or link already exists',
      );
    }
    return err;
  }
}
