import { Injectable } from '@nestjs/common';
import { z } from '@matilda/validation';
import { ApiException } from '../../common/errors/api-exception';
import { PrismaService } from '../../database/prisma.service';
import { withScope } from '../../database/scope';
import { AuthorizationService } from '../iam/authorization/authorization.service';
import { PERMISSION_CATALOG } from '../iam/permissions/catalog';
import { AuditService } from '../audit/audit.service';
import { type AdminActor, notFound } from './admin-common';

export const roleBody = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  permissions: z.array(z.string().max(80)).max(200),
});
export const updateRoleBody = roleBody.partial();
export const cloneRoleBody = z.object({ name: z.string().trim().min(2).max(80) });

export const auditQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  actorType: z.enum(['STAFF', 'CUSTOMER', 'GUEST', 'SYSTEM']).optional(),
  actorId: z.string().uuid().optional(),
  action: z.string().max(100).optional(),
  targetType: z.string().max(60).optional(),
  targetId: z.string().max(100).optional(),
  outcome: z.enum(['SUCCESS', 'DENIED', 'FAILED']).optional(),
  brandId: z.string().uuid().optional(),
  before: z
    .string()
    .regex(/^\d{1,18}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const ADMIN_BRAND_HEADER = 'x-admin-brand';

@Injectable()
export class AccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ roles and permissions

  permissions() {
    return PERMISSION_CATALOG.map((p) => ({
      key: p.key,
      group: p.group,
      description: p.description,
      sensitive: p.sensitive,
    }));
  }

  async listRoles() {
    const roles = await this.prisma.client.role.findMany({
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
      include: { permissions: { select: { permissionKey: true } } },
    });
    return roles.map((r) => this.shape(r));
  }

  async getRole(id: string) {
    const role = await this.prisma.client.role.findUnique({
      where: { id },
      include: { permissions: { select: { permissionKey: true } } },
    });
    if (!role) throw notFound('Role');
    return this.shape(role);
  }

  private shape(r: {
    id: string;
    name: string;
    description: string | null;
    kind: string;
    systemKey: string | null;
    permissions: { permissionKey: string }[];
  }) {
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      kind: r.kind,
      editable: r.kind === 'CUSTOM',
      permissions: r.permissions.map((p) => p.permissionKey).sort(),
    };
  }

  // ------------------------------------------------------------------ audit

  async queryAudit(actor: AdminActor, q: z.infer<typeof auditQuery>) {
    const scope = await this.authz.dbScopeFor(actor.grants, 'audit.view');
    return this.audit.query(scope, { ...q, before: q.before ? BigInt(q.before) : undefined });
  }

  // ------------------------------------------------------------------ context

  /**
   * Who am I and what can I reach. `X-Admin-Brand` lets the admin UI pick a working brand; it is
   * validated here against the actor's grants and never trusted as an authorization input
   * (every endpoint still checks scope on its own).
   */
  async context(actor: AdminActor, brandHeader: string | undefined) {
    const staff = await this.prisma.client.staffUser.findUniqueOrThrow({
      where: { id: actor.staffId },
      select: { id: true, email: true, fullName: true },
    });
    const reach = await this.authz.dbScopeForAny(actor.grants);
    const platform = { brandIds: [], platform: true } as const;
    const names = await withScope(this.prisma.client, platform, async (tx) => ({
      brands: await tx.brand.findMany({
        where: reach.platform ? {} : { id: { in: [...reach.brandIds] } },
        select: { id: true, slug: true, name: true },
        orderBy: { name: 'asc' },
      }),
      assignments: await tx.staffRoleAssignment.findMany({
        where: { id: { in: actor.grants.map((g) => g.assignmentId) } },
        select: {
          id: true,
          expiresAt: true,
          role: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          market: { select: { id: true, code: true } },
          branch: { select: { id: true, code: true, name: true } },
        },
      }),
    }));

    let activeBrandId: string | null = null;
    if (brandHeader !== undefined) {
      if (!z.string().uuid().safeParse(brandHeader).success) {
        throw new ApiException(400, 'INVALID_ADMIN_CONTEXT', 'X-Admin-Brand must be a brand id');
      }
      if (!names.brands.some((b) => b.id === brandHeader)) {
        throw new ApiException(403, 'ADMIN_CONTEXT_FORBIDDEN', 'You have no access to that brand');
      }
      activeBrandId = brandHeader;
    }

    const grantById = new Map(actor.grants.map((g) => [g.assignmentId, g]));
    return {
      staff,
      platformWide: reach.platform === true,
      activeBrandId,
      brands: names.brands,
      assignments: names.assignments.map((a) => ({
        id: a.id,
        role: a.role,
        brand: a.brand,
        market: a.market,
        branch: a.branch,
        expiresAt: a.expiresAt,
        permissions: [...(grantById.get(a.id)?.permissions ?? [])].sort(),
      })),
    };
  }
}
