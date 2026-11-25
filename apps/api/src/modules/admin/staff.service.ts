import { Injectable } from '@nestjs/common';
import { z } from '@matilda/validation';
import { ApiException } from '../../common/errors/api-exception';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { isPlatformScope, scopesFor, type Scope } from '../iam/authorization/scope';
import {
  AssignmentService,
  assertAnotherSuperAdminExists,
  lockSuperAdmins,
} from '../iam/roles/assignment.service';
import { StaffAuthService } from '../staff-auth/staff-auth.service';
import { StaffSessionService } from '../staff-auth/session.service';
import {
  type AdminActor,
  assertCan,
  isUniqueViolation,
  notFound,
  paginate,
  visibleTo,
} from './admin-common';

const scopeFields = {
  brandId: z.string().uuid().nullish(),
  marketId: z.string().uuid().nullish(),
  branchId: z.string().uuid().nullish(),
};
export const inviteStaffBody = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  fullName: z.string().trim().min(1).max(160),
  phone: z.string().trim().max(40).optional(),
  roleId: z.string().uuid(),
  ...scopeFields,
});
export const updateStaffBody = z
  .object({
    fullName: z.string().trim().min(1).max(160),
    phone: z.string().trim().max(40).nullable(),
  })
  .partial();
export const staffStatusBody = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']) });
export const assignmentBody = z.object({
  roleId: z.string().uuid(),
  expiresAt: z.coerce.date().optional(),
  ...scopeFields,
});
export const staffListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(),
  search: z.string().trim().max(100).optional(),
});

/** Never selects credentials. */
const SELECT = (now = new Date()) =>
  ({
    id: true,
    email: true,
    fullName: true,
    phone: true,
    status: true,
    mfaEnrolledAt: true,
    lastLoginAt: true,
    createdAt: true,
    assignments: {
      where: {
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: {
        id: true,
        roleId: true,
        brandId: true,
        marketId: true,
        branchId: true,
        expiresAt: true,
        role: { select: { id: true, name: true, kind: true } },
      },
    },
  }) satisfies Prisma.StaffUserSelect;

type StaffRow = Prisma.StaffUserGetPayload<{ select: ReturnType<typeof SELECT> }>;

const scopeOf = (a: Scope): Scope => ({
  brandId: a.brandId ?? null,
  marketId: a.marketId ?? null,
  branchId: a.branchId ?? null,
});

const TRANSITIONS: Record<string, readonly string[]> = {
  INVITED: ['DEACTIVATED'],
  ACTIVE: ['SUSPENDED', 'DEACTIVATED'],
  SUSPENDED: ['ACTIVE', 'DEACTIVATED'],
  DEACTIVATED: [],
};

/**
 * Staff administration. A staff member is visible to an actor whose `users.view` scope covers one of
 * the member's active assignments (everyone for platform-wide holders); they are manageable when the
 * actor's `users.manage` covers ALL of them, so nobody can touch someone who also works elsewhere.
 */
@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly assignments: AssignmentService,
    private readonly auth: StaffAuthService,
    private readonly sessions: StaffSessionService,
  ) {}

  async list(actor: AdminActor, query: z.infer<typeof staffListQuery>) {
    const rows = await this.prisma.client.staffUser.findMany({
      where: {
        status: query.status,
        ...(query.search && {
          OR: [
            { email: { contains: query.search.toLowerCase() } },
            { fullName: { contains: query.search, mode: 'insensitive' } },
          ],
        }),
      },
      select: SELECT(),
      orderBy: { createdAt: 'desc' },
    });
    return paginate(this.visible(actor, rows), query.page, query.pageSize);
  }

  async get(actor: AdminActor, id: string) {
    const row = await this.load(id);
    if (!row || this.visible(actor, [row]).length === 0) throw notFound('Staff member');
    return row;
  }

  async invite(actor: AdminActor, input: z.infer<typeof inviteStaffBody>) {
    const scope = scopeOf(input);
    await this.assignments.assertGrantable(actor.grants, input.roleId, scope);
    let id: string;
    try {
      id = await this.prisma.client.$transaction(async (tx) => {
        const staff = await tx.staffUser.create({
          data: {
            email: input.email,
            fullName: input.fullName,
            phone: input.phone,
            status: 'INVITED',
          },
        });
        await tx.staffRoleAssignment.create({
          data: {
            ...scope,
            staffUserId: staff.id,
            roleId: input.roleId,
            grantedById: actor.staffId,
          },
        });
        await this.audit.record(tx, {
          action: 'staff.create',
          targetType: 'staff_user',
          targetId: staff.id,
          actor: { type: 'STAFF', id: actor.staffId },
          ...scope,
          after: { email: input.email, fullName: input.fullName, roleId: input.roleId, ...scope },
        });
        return staff.id;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ApiException(409, 'EMAIL_TAKEN', 'A staff member with this email already exists');
      }
      if (err instanceof Error && /foreign key|inconsistent|violat/i.test(err.message)) {
        throw new ApiException(
          422,
          'INVALID_SCOPE',
          'The brand, market and branch combination is invalid',
        );
      }
      throw err;
    }
    const { link } = await this.auth.invite(id, actor.staffId);
    return { staff: await this.get(actor, id), inviteLink: link };
  }

  /** Issues a fresh invitation (invalidating earlier ones) for a staff member who has not accepted yet. */
  async reinvite(actor: AdminActor, id: string) {
    await this.manageable(actor, id);
    const { link } = await this.auth.invite(id, actor.staffId);
    return { inviteLink: link };
  }

  async update(actor: AdminActor, id: string, patch: z.infer<typeof updateStaffBody>) {
    const before = await this.manageable(actor, id);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.staffUser.update({ where: { id }, data: patch });
      await this.audit.record(tx, {
        action: 'staff.update',
        targetType: 'staff_user',
        targetId: id,
        actor: { type: 'STAFF', id: actor.staffId },
        before: { fullName: before.fullName, phone: before.phone },
        after: patch,
      });
    });
    return this.get(actor, id);
  }

  async setStatus(actor: AdminActor, id: string, status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED') {
    if (id === actor.staffId) {
      throw new ApiException(409, 'CANNOT_MODIFY_SELF', 'You cannot change your own status');
    }
    const target = await this.manageable(actor, id);
    if (!TRANSITIONS[target.status]?.includes(status)) {
      throw new ApiException(
        409,
        'INVALID_TRANSITION',
        `Cannot change ${target.status} to ${status}`,
      );
    }
    await this.prisma.client.$transaction(async (tx) => {
      await lockSuperAdmins(tx);
      if (status !== 'ACTIVE') await assertAnotherSuperAdminExists(tx, { excludeStaffId: id });
      if (status === 'ACTIVE') {
        const hasPassword = await tx.staffUser.count({
          where: { id, passwordHash: { not: null } },
        });
        if (hasPassword === 0) {
          throw new ApiException(409, 'NOT_ACTIVATED', 'This member has not set a password yet');
        }
      }
      await tx.staffUser.update({ where: { id }, data: { status } });
      await this.audit.record(tx, {
        action: `staff.${status.toLowerCase()}`,
        targetType: 'staff_user',
        targetId: id,
        actor: { type: 'STAFF', id: actor.staffId },
        before: { status: target.status },
        after: { status },
      });
    });
    if (status !== 'ACTIVE') await this.sessions.revokeAll(id);
    return this.get(actor, id);
  }

  async grant(actor: AdminActor, staffId: string, input: z.infer<typeof assignmentBody>) {
    await this.get(actor, staffId);
    return this.assignments.grant(actor.grants, { ...input, staffUserId: staffId }, actor.staffId);
  }

  async revoke(actor: AdminActor, assignmentId: string): Promise<void> {
    await this.assignments.revoke(actor.grants, assignmentId, actor.staffId);
  }

  // ------------------------------------------------------------------ internals

  private load(id: string): Promise<StaffRow | null> {
    return this.prisma.client.staffUser.findUnique({ where: { id }, select: SELECT() });
  }

  private visible(actor: AdminActor, rows: StaffRow[]): StaffRow[] {
    if (scopesFor(actor.grants, 'users.view').some(isPlatformScope)) return rows;
    return visibleTo(actor.grants, 'users.view', rows, (s) => s.assignments.map(scopeOf));
  }

  /** Visible AND covered by `users.manage` for every active assignment (platform-only when none). */
  private async manageable(actor: AdminActor, id: string): Promise<StaffRow> {
    const row = await this.get(actor, id);
    if (row.assignments.length === 0) assertCan(actor.grants, 'users.manage', {});
    for (const a of row.assignments) assertCan(actor.grants, 'users.manage', scopeOf(a));
    return row;
  }
}
