import type { PrismaClient } from '../../generated/prisma/client';
import { PERMISSION_CATALOG } from './permissions/catalog';
import { ROLE_TEMPLATES } from './permissions/role-templates';

/**
 * Makes the database match the code: permission catalog, the 12 system roles and their default
 * permission sets. Idempotent. Must run as the OWNER role (the runtime role may not change
 * permissions or system roles). Custom roles are never touched; permissions that were removed from
 * the catalog are also removed from every role.
 */
export async function syncAccessControl(client: PrismaClient): Promise<void> {
  await client.$transaction(async (tx) => {
    for (const p of PERMISSION_CATALOG) {
      await tx.permission.upsert({
        where: { key: p.key },
        create: {
          key: p.key,
          groupName: p.group,
          description: p.description,
          isSensitive: p.sensitive,
        },
        update: { groupName: p.group, description: p.description, isSensitive: p.sensitive },
      });
    }

    for (const t of ROLE_TEMPLATES) {
      const role = await tx.role.upsert({
        where: { systemKey: t.systemKey },
        create: {
          name: t.name,
          description: t.description,
          kind: 'SYSTEM',
          systemKey: t.systemKey,
          isLocked: true,
        },
        update: { name: t.name, description: t.description, isLocked: true },
      });
      await tx.rolePermission.deleteMany({
        where: { roleId: role.id, permissionKey: { notIn: [...t.permissions] } },
      });
      await tx.rolePermission.createMany({
        data: t.permissions.map((permissionKey) => ({ roleId: role.id, permissionKey })),
        skipDuplicates: true,
      });
    }

    const keys = PERMISSION_CATALOG.map((p) => p.key as string);
    await tx.rolePermission.deleteMany({ where: { permissionKey: { notIn: keys } } });
    await tx.permission.deleteMany({ where: { key: { notIn: keys } } });
  });
}
