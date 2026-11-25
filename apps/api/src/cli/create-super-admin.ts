import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { withScope } from '../database/scope';
import { SUPER_ADMIN_SYSTEM_KEY } from '../modules/iam/permissions/role-templates';
import { INVITE_TTL_MS, issueStaffToken } from '../modules/staff-auth/staff-token';

export interface CreateSuperAdminInput {
  email: string;
  fullName: string;
  /** Allows creating another Super Admin although an active one exists (lock-out recovery). */
  forceRecovery?: boolean;
  adminBaseUrl: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Bootstrap/recovery path for the first (or a replacement) platform Super Admin. No password is ever
 * set or printed: the command returns a one-time invitation link, and the person chooses their own
 * password and enrolls 2FA through it. Runs as the owner role (platform scope), audited as SYSTEM.
 */
export async function createSuperAdmin(
  client: PrismaClient,
  input: CreateSuperAdminInput,
): Promise<{ link: string; staffUserId: string }> {
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();
  if (!EMAIL.test(email) || email.length > 254) throw new Error('A valid --email is required');
  if (!fullName) throw new Error('--name is required');

  return withScope(client, { brandIds: [], platform: true }, async (tx) => {
    const role = await tx.role.findFirst({ where: { systemKey: SUPER_ADMIN_SYSTEM_KEY } });
    if (!role) throw new Error('Super Admin role not found; run `pnpm db:seed` first');

    const activeSuperAdmins = await tx.staffRoleAssignment.count({
      where: {
        roleId: role.id,
        revokedAt: null,
        brandId: null,
        marketId: null,
        branchId: null,
        staffUser: { status: 'ACTIVE' },
      },
    });
    if (activeSuperAdmins > 0 && !input.forceRecovery) {
      throw new Error(
        'An active Super Admin already exists. Create further admins through the admin panel, ' +
          'or pass --force-recovery if every Super Admin is locked out.',
      );
    }

    const existing = await tx.staffUser.findFirst({ where: { email } });
    if (existing && existing.status !== 'INVITED') {
      throw new Error(
        'That email already belongs to a staff account that has been activated. ' +
          'Use the password-reset flow instead.',
      );
    }
    const staff =
      existing ?? (await tx.staffUser.create({ data: { email, fullName, status: 'INVITED' } }));

    const alreadyAssigned = await tx.staffRoleAssignment.count({
      where: { staffUserId: staff.id, roleId: role.id, revokedAt: null },
    });
    if (alreadyAssigned === 0) {
      await tx.staffRoleAssignment.create({ data: { staffUserId: staff.id, roleId: role.id } });
    }
    const token = await issueStaffToken(tx, staff.id, 'INVITE', INVITE_TTL_MS);
    await tx.auditLog.createMany({
      data: [
        {
          actorType: 'SYSTEM',
          action: 'cli.super_admin.invite',
          targetType: 'staff_user',
          targetId: staff.id,
          after: { forceRecovery: input.forceRecovery === true, reusedInvitedAccount: !!existing },
        },
      ],
    });
    const base = input.adminBaseUrl.replace(/\/+$/, '');
    return { link: `${base}/accept-invite?token=${token}`, staffUserId: staff.id };
  });
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL (owner role) is not set');
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const { link } = await createSuperAdmin(client, {
      email: arg('email') ?? '',
      fullName: arg('name') ?? '',
      forceRecovery: process.argv.includes('--force-recovery'),
      adminBaseUrl: process.env.ADMIN_BASE_URL ?? 'http://localhost:3001',
    });
    process.stdout.write(
      `Invitation created (valid 72 hours, single use). Share this link only with the invitee:\n${link}\n`,
    );
  } finally {
    await client.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
