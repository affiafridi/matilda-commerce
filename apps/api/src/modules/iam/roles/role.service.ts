import { Injectable } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api-exception';
import { PrismaService } from '../../../database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { canAnywhere, type Grant } from '../authorization/scope';
import { isCatalogPermission } from '../permissions/catalog';

export interface CustomRoleInput {
  name: string;
  description?: string;
  permissions: readonly string[];
}

/** Custom role management. System roles are immutable (service check plus a database trigger). */
@Injectable()
export class RoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createCustom(
    actor: readonly Grant[],
    input: CustomRoleInput,
    actorId: string,
    clonedFrom?: string,
  ) {
    const permissions = this.validatedPermissions(actor, input.permissions);
    await this.assertNameFree(input.name);
    return this.prisma.client.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: {
          name: input.name.trim(),
          description: input.description,
          kind: 'CUSTOM',
          permissions: { create: permissions.map((permissionKey) => ({ permissionKey })) },
        },
      });
      await this.audit.record(tx, {
        action: clonedFrom ? 'role.clone' : 'role.create',
        targetType: 'role',
        targetId: role.id,
        actor: { type: 'STAFF', id: actorId },
        after: { name: role.name, permissions, clonedFrom },
      });
      return role;
    });
  }

  /** Replaces the role's permissions and/or edits name and description. */
  async updateCustom(
    actor: readonly Grant[],
    roleId: string,
    patch: Partial<CustomRoleInput>,
    actorId: string,
  ) {
    const role = await this.requireCustom(roleId);
    if (patch.name !== undefined && patch.name.trim().toLowerCase() !== role.name.toLowerCase()) {
      await this.assertNameFree(patch.name);
    }
    const next = patch.permissions
      ? this.validatedPermissions(actor, patch.permissions)
      : undefined;
    return this.prisma.client.$transaction(async (tx) => {
      const current = await tx.rolePermission.findMany({ where: { roleId } });
      const before = {
        name: role.name,
        description: role.description,
        permissions: current.map((p) => p.permissionKey).sort(),
      };
      if (next) {
        const existing = new Set(current.map((p) => p.permissionKey));
        // Only newly added permissions must be held by the actor; keeping or removing is always allowed.
        const added = next.filter((k) => !existing.has(k));
        this.assertHolds(actor, added);
        await tx.rolePermission.deleteMany({ where: { roleId, permissionKey: { notIn: next } } });
        await tx.rolePermission.createMany({
          data: next.map((permissionKey) => ({ roleId, permissionKey })),
          skipDuplicates: true,
        });
      }
      const updated = await tx.role.update({
        where: { id: roleId },
        data: { name: patch.name?.trim(), description: patch.description },
      });
      await this.audit.record(tx, {
        action: 'role.update',
        targetType: 'role',
        targetId: roleId,
        actor: { type: 'STAFF', id: actorId },
        before,
        after: {
          name: updated.name,
          description: updated.description,
          permissions: (next ?? before.permissions).slice().sort(),
        },
      });
      return updated;
    });
  }

  async deleteCustom(roleId: string, actorId: string): Promise<void> {
    const role = await this.requireCustom(roleId);
    const inUse = await this.prisma.client.staffRoleAssignment.count({
      where: { roleId, revokedAt: null },
    });
    if (inUse > 0) {
      throw new ApiException(
        409,
        'ROLE_IN_USE',
        'Revoke the active assignments of this role first',
      );
    }
    await this.prisma.client.$transaction(async (tx) => {
      await tx.role.delete({ where: { id: roleId } });
      await this.audit.record(tx, {
        action: 'role.delete',
        targetType: 'role',
        targetId: roleId,
        actor: { type: 'STAFF', id: actorId },
        before: { name: role.name },
      });
    });
  }

  /** Copies any role (including a system template) into a new editable custom role. */
  async clone(actor: readonly Grant[], roleId: string, name: string, actorId: string) {
    const source = await this.prisma.client.role.findUnique({
      where: { id: roleId },
      include: { permissions: true },
    });
    if (!source) throw new ApiException(404, 'ROLE_NOT_FOUND', 'Role not found');
    return this.createCustom(
      actor,
      {
        name,
        description: source.description ?? undefined,
        permissions: source.permissions.map((p) => p.permissionKey),
      },
      actorId,
      roleId,
    );
  }

  private validatedPermissions(actor: readonly Grant[], keys: readonly string[]): string[] {
    const unique = [...new Set(keys)];
    const unknown = unique.filter((k) => !isCatalogPermission(k));
    if (unknown.length > 0) {
      throw new ApiException(
        422,
        'UNKNOWN_PERMISSION',
        `Unknown permission: ${unknown.join(', ')}`,
      );
    }
    this.assertHolds(actor, unique);
    return unique;
  }

  /** Nobody can put a permission into a role that they do not hold themselves (escalation). */
  private assertHolds(actor: readonly Grant[], keys: readonly string[]): void {
    const missing = keys.filter((k) => !canAnywhere(actor, k));
    if (missing.length > 0) {
      throw new ApiException(403, 'ESCALATION_DENIED', `You do not hold: ${missing.join(', ')}`);
    }
  }

  private async requireCustom(roleId: string) {
    const role = await this.prisma.client.role.findUnique({ where: { id: roleId } });
    if (!role) throw new ApiException(404, 'ROLE_NOT_FOUND', 'Role not found');
    if (role.kind === 'SYSTEM') {
      throw new ApiException(
        409,
        'SYSTEM_ROLE_IMMUTABLE',
        'System roles cannot be changed; clone it instead',
      );
    }
    return role;
  }

  private async assertNameFree(name: string): Promise<void> {
    const clash = await this.prisma.client.role.findFirst({
      where: { name: { equals: name.trim(), mode: 'insensitive' } },
    });
    if (clash)
      throw new ApiException(409, 'ROLE_NAME_TAKEN', 'A role with this name already exists');
  }
}
