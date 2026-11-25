import { Injectable } from '@nestjs/common';
import { z } from '@matilda/validation';
import { PrismaService } from '../../database/prisma.service';
import { withScope } from '../../database/scope';
import type { Prisma } from '../../generated/prisma/client';
import { isPlatformScope, scopesFor } from '../iam/authorization/scope';
import { type AdminActor, notFound, paginate } from './admin-common';

export const customerListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  brandId: z.string().uuid().optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETION_REQUESTED']).optional(),
  search: z.string().trim().max(100).optional(),
});

/** Support view: no credentials, no tokens, no sessions. */
const SELECT = {
  id: true,
  brandId: true,
  email: true,
  emailVerifiedAt: true,
  phone: true,
  fullName: true,
  status: true,
  marketingConsent: true,
  deletionRequestedAt: true,
  lastLoginAt: true,
  createdAt: true,
} satisfies Prisma.CustomerSelect;

/**
 * Customers belong to a brand, not to a market or branch, so only grants that are platform-wide or
 * brand-wide (no market/branch restriction) can see them.
 */
@Injectable()
export class CustomersAdminService {
  constructor(private readonly prisma: PrismaService) {}

  private scopeOf(actor: AdminActor) {
    const scopes = scopesFor(actor.grants, 'customers.view');
    if (scopes.some(isPlatformScope)) return { brandIds: [], platform: true } as const;
    const brandIds = scopes
      .filter((s) => s.brandId && !s.marketId && !s.branchId)
      .map((s) => s.brandId as string);
    return { brandIds };
  }

  async list(actor: AdminActor, q: z.infer<typeof customerListQuery>) {
    const where: Prisma.CustomerWhereInput = {
      brandId: q.brandId,
      status: q.status,
      ...(q.search && {
        OR: [
          { email: { contains: q.search.toLowerCase() } },
          { fullName: { contains: q.search, mode: 'insensitive' } },
        ],
      }),
    };
    const [rows, total] = await withScope(this.prisma.client, this.scopeOf(actor), async (tx) => [
      await tx.customer.findMany({
        where,
        select: SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      await tx.customer.count({ where }),
    ]);
    return { ...paginate([], q.page, q.pageSize), items: rows, total };
  }

  async get(actor: AdminActor, id: string) {
    const row = await withScope(this.prisma.client, this.scopeOf(actor), (tx) =>
      tx.customer.findUnique({ where: { id }, select: SELECT }),
    );
    if (!row) throw notFound('Customer');
    return row;
  }
}
