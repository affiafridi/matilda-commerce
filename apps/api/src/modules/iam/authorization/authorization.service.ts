import { Injectable } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api-exception';
import { PrismaService } from '../../../database/prisma.service';
import { withScope, type DbScope } from '../../../database/scope';
import { can, isPlatformScope, scopesFor, type Grant, type Scope } from './scope';

/**
 * Loads a staff member's effective grants and answers permission/scope questions.
 * Authorization is by permission and scope only; role names are never inspected here.
 */
@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Active grants: not revoked, not expired, and the staff account itself is ACTIVE. */
  async loadGrants(staffUserId: string): Promise<Grant[]> {
    const rows = await this.prisma.client.staffRoleAssignment.findMany({
      where: {
        staffUserId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        staffUser: { status: 'ACTIVE' },
      },
      select: {
        id: true,
        roleId: true,
        brandId: true,
        marketId: true,
        branchId: true,
        role: { select: { permissions: { select: { permissionKey: true } } } },
      },
    });
    return rows.map((r) => ({
      assignmentId: r.id,
      roleId: r.roleId,
      permissions: new Set(r.role.permissions.map((p) => p.permissionKey)),
      scope: { brandId: r.brandId, marketId: r.marketId, branchId: r.branchId },
    }));
  }

  /** Throws 403 unless the actor holds `permission` over `target`. */
  assertCan(grants: readonly Grant[], permission: string, target: Scope): void {
    if (!can(grants, permission, target)) {
      throw new ApiException(403, 'FORBIDDEN', 'You do not have permission to perform this action');
    }
  }

  /**
   * Database scope for listing data the actor may see through `permission`: platform-wide, or the
   * set of brands their grants reach (branch-only grants resolve to the brands the branch serves).
   */
  async dbScopeFor(grants: readonly Grant[], permission: string): Promise<DbScope> {
    return this.dbScopeOf(scopesFor(grants, permission));
  }

  /** Brands reachable through any grant at all (for the admin context; not tied to one permission). */
  async dbScopeForAny(grants: readonly Grant[]): Promise<DbScope> {
    return this.dbScopeOf(grants.map((g) => g.scope));
  }

  private async dbScopeOf(scopes: readonly Scope[]): Promise<DbScope> {
    if (scopes.some(isPlatformScope)) return { brandIds: [], platform: true };

    const brandIds = new Set<string>();
    const branchIds: string[] = [];
    for (const s of scopes) {
      if (s.brandId) brandIds.add(s.brandId);
      else if (s.branchId) branchIds.push(s.branchId);
    }
    if (branchIds.length > 0) {
      const links = await withScope(this.prisma.client, { brandIds: [], platform: true }, (tx) =>
        tx.branchMarket.findMany({
          where: { branchId: { in: branchIds } },
          select: { market: { select: { brandId: true } } },
        }),
      );
      for (const l of links) brandIds.add(l.market.brandId);
    }
    return { brandIds: [...brandIds] };
  }
}
