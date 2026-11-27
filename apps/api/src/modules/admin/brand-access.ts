import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { withScope } from '../../database/scope';
import { AuditService } from '../audit/audit.service';
import { ApiException } from '../../common/errors/api-exception';
import { type AdminActor, assertCan, notFound } from './admin-common';
import { can, type Scope } from '../iam/authorization/scope';

export type Tx = Prisma.TransactionClient;

/**
 * Entry point of every brand-scoped service call (catalog, delivery, inventory): checks the
 * permission over the brand, opens a brand-scoped transaction (row-level security applies) and
 * confirms the brand exists. Services never read or write brand-keyed tables outside it.
 */
@Injectable()
export class BrandScopedAccess {
  constructor(
    protected readonly prisma: PrismaService,
    protected readonly audit: AuditService,
  ) {}

  /** Extra permission check inside a call (e.g. scheduling needs publish rights as well as edit). */
  require(actor: AdminActor, brandId: string, permission: string): void {
    assertCan(actor.grants, permission, { brandId });
  }

  async run<T>(
    actor: AdminActor,
    brandId: string,
    permission: string,
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    assertCan(actor.grants, permission, { brandId });
    return withScope(this.prisma.client, { brandIds: [brandId] }, async (tx) => {
      const brand = await tx.brand.findFirst({ where: { id: brandId }, select: { id: true } });
      if (!brand) throw notFound('Brand');
      return fn(tx);
    });
  }

  /**
   * Like `run`, for records below the brand (a branch's calendar): any one of `permissions` held
   * over the exact target scope (brand, and market or branch when given) is enough.
   */
  async runAt<T>(
    actor: AdminActor,
    target: Scope & { brandId: string },
    permissions: readonly string[],
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    if (!permissions.some((p) => can(actor.grants, p, target))) {
      throw new ApiException(403, 'FORBIDDEN', 'You do not have permission to perform this action');
    }
    return withScope(this.prisma.client, { brandIds: [target.brandId] }, async (tx) => {
      const brand = await tx.brand.findFirst({
        where: { id: target.brandId },
        select: { id: true },
      });
      if (!brand) throw notFound('Brand');
      return fn(tx);
    });
  }

  /** Brand-scoped read for public routes (no staff actor): the brand id comes from the URL. */
  runPublic<T>(brandId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withScope(this.prisma.client, { brandIds: [brandId] }, fn);
  }

  /**
   * Entry check for routes whose records sit below the brand: some grant of one of `permissions`
   * must reach into this brand (a market or branch grant of the brand counts). Rows are then
   * filtered or checked per scope by the caller.
   */
  assertReaches(actor: AdminActor, brandId: string, permissions: readonly string[]): void {
    const reaches = actor.grants.some(
      (g) =>
        permissions.some((p) => g.permissions.has(p)) &&
        (g.scope.brandId == null || g.scope.brandId === brandId),
    );
    if (!reaches) {
      throw new ApiException(403, 'FORBIDDEN', 'You do not have permission to perform this action');
    }
  }

  /** Audit row for a record that belongs to a market or a branch as well as the brand. */
  recordFor(
    tx: Tx,
    actor: AdminActor,
    entry: {
      brandId: string;
      marketId?: string | null;
      branchId?: string | null;
      action: string;
      targetType: string;
      targetId: string;
      before?: unknown;
      after?: unknown;
    },
  ): Promise<void> {
    return this.audit.record(tx, { ...entry, actor: { type: 'STAFF', id: actor.staffId } });
  }

  record(
    tx: Tx,
    actor: AdminActor,
    brandId: string,
    action: string,
    targetType: string,
    targetId: string,
    before?: unknown,
    after?: unknown,
  ): Promise<void> {
    return this.audit.record(tx, {
      action,
      targetType,
      targetId,
      actor: { type: 'STAFF', id: actor.staffId },
      brandId,
      before,
      after,
    });
  }
}
