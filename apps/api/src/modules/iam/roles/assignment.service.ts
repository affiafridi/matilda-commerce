import { Injectable } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api-exception';
import { PrismaService } from '../../../database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { Prisma } from '../../../generated/prisma/client';
import { can, ungrantable, type Grant, type Scope } from '../authorization/scope';
import { SUPER_ADMIN_SYSTEM_KEY } from '../permissions/role-templates';

export interface GrantInput extends Scope {
  staffUserId: string;
  roleId: string;
  expiresAt?: Date;
}

const LOCK_NAME = 'matilda.last_super_admin';

/**
 * Role assignment with the safeguards from the plan: the actor needs `users.manage` over the scope,
 * cannot hand out permissions they do not hold there (escalation), and the last active Super Admin
 * can never be removed.
 */
@Injectable()
export class AssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Throws unless the actor may assign `roleId` at `scope`: needs `users.manage` there and every
   * permission of the role over that scope (no escalation).
   */
  async assertGrantable(actor: readonly Grant[], roleId: string, scope: Scope): Promise<void> {
    if (!can(actor, 'users.manage', scope)) {
      throw new ApiException(
        403,
        'FORBIDDEN',
        'You do not have permission to assign roles in this scope',
      );
    }
    const role = await this.prisma.client.role.findUnique({
      where: { id: roleId },
      select: { permissions: { select: { permissionKey: true } } },
    });
    if (!role) throw new ApiException(404, 'ROLE_NOT_FOUND', 'Role not found');
    const blocked = ungrantable(
      actor,
      role.permissions.map((p) => p.permissionKey),
      scope,
    );
    if (blocked.length > 0) {
      throw new ApiException(
        403,
        'ESCALATION_DENIED',
        `You cannot grant here: ${blocked.join(', ')}`,
      );
    }
  }

  async grant(actor: readonly Grant[], input: GrantInput, grantedById: string) {
    const scope: Scope = {
      brandId: input.brandId ?? null,
      marketId: input.marketId ?? null,
      branchId: input.branchId ?? null,
    };
    await this.assertGrantable(actor, input.roleId, scope);
    const staff = await this.prisma.client.staffUser.findUnique({
      where: { id: input.staffUserId },
      select: { status: true },
    });
    if (!staff || staff.status === 'DEACTIVATED') {
      throw new ApiException(404, 'STAFF_NOT_FOUND', 'Staff user not found');
    }

    try {
      return await this.prisma.client.$transaction(async (tx) => {
        const created = await tx.staffRoleAssignment.create({
          data: {
            ...scope,
            staffUserId: input.staffUserId,
            roleId: input.roleId,
            expiresAt: input.expiresAt,
            grantedById,
          },
        });
        await this.audit.record(tx, {
          action: 'assignment.grant',
          targetType: 'staff_user',
          targetId: input.staffUserId,
          actor: { type: 'STAFF', id: grantedById },
          ...scope,
          after: {
            assignmentId: created.id,
            roleId: input.roleId,
            ...scope,
            expiresAt: input.expiresAt,
          },
        });
        return created;
      });
    } catch (err) {
      // Foreign keys and the scope-consistency trigger reject market/brand/branch combinations that do not exist.
      const text = err instanceof Error ? `${err.message} ${String(err.cause ?? '')}` : '';
      if (!/foreign key|inconsistent|constraint|violat/i.test(text)) throw err;
      throw new ApiException(
        422,
        'INVALID_SCOPE',
        'The brand, market and branch combination is invalid',
      );
    }
  }

  async revoke(actor: readonly Grant[], assignmentId: string, actorId: string): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LOCK_NAME}))`;
      const assignment = await tx.staffRoleAssignment.findFirst({
        where: { id: assignmentId, revokedAt: null },
      });
      if (!assignment) throw new ApiException(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found');
      if (!can(actor, 'users.manage', assignment)) {
        throw new ApiException(
          403,
          'FORBIDDEN',
          'You do not have permission to revoke roles in this scope',
        );
      }
      await assertAnotherSuperAdminExists(tx, { excludeAssignmentId: assignmentId });
      await tx.staffRoleAssignment.update({
        where: { id: assignmentId },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'assignment.revoke',
        targetType: 'staff_user',
        targetId: assignment.staffUserId,
        actor: { type: 'STAFF', id: actorId },
        brandId: assignment.brandId,
        marketId: assignment.marketId,
        branchId: assignment.branchId,
        before: { assignmentId, roleId: assignment.roleId },
      });
    });
  }
}

/**
 * Guard for any operation that could remove Super Admin power (revoking the assignment, suspending or
 * deactivating the staff member). Call inside a transaction that holds the advisory lock
 * (`lockSuperAdmins`) so two concurrent removals cannot both pass.
 */
export async function assertAnotherSuperAdminExists(
  tx: Prisma.TransactionClient,
  exclude: { excludeAssignmentId?: string; excludeStaffId?: string },
): Promise<void> {
  const activeSuperAdmin: Prisma.StaffRoleAssignmentWhereInput = {
    revokedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    role: { systemKey: SUPER_ADMIN_SYSTEM_KEY },
    brandId: null,
    marketId: null,
    branchId: null,
    staffUser: { status: 'ACTIVE' },
  };
  const isExcluded: Prisma.StaffRoleAssignmentWhereInput = {
    OR: [
      ...(exclude.excludeAssignmentId ? [{ id: exclude.excludeAssignmentId }] : []),
      ...(exclude.excludeStaffId ? [{ staffUserId: exclude.excludeStaffId }] : []),
    ],
  };
  // Only operations that touch a platform-wide Super Admin assignment can break the rule.
  const affects = await tx.staffRoleAssignment.count({
    where: { AND: [activeSuperAdmin, isExcluded] },
  });
  if (affects === 0) return;
  const others = await tx.staffRoleAssignment.count({
    where: { AND: [activeSuperAdmin, { NOT: isExcluded }] },
  });
  if (others === 0) {
    throw new ApiException(409, 'LAST_SUPER_ADMIN', 'At least one active Super Admin must remain');
  }
}

export async function lockSuperAdmins(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LOCK_NAME}))`;
}
