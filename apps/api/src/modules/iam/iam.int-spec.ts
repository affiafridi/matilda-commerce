import { PrismaPg } from '@prisma/adapter-pg';
import { uuidv7 } from '../../common/ids/uuid7';
import { withScope } from '../../database/scope';
import type { PrismaService } from '../../database/prisma.service';
import { PrismaClient } from '../../generated/prisma/client';
import { testAppUrl, testOwnerUrl } from '../../test-support/test-db';
import { syncAccessControl } from './access-control-sync';
import { AuthorizationService } from './authorization/authorization.service';
import { PERMISSION_CATALOG } from './permissions/catalog';
import { ROLE_TEMPLATES, SUPER_ADMIN_SYSTEM_KEY } from './permissions/role-templates';
import { AssignmentService, type GrantInput } from './roles/assignment.service';
import { type CustomRoleInput, RoleService } from './roles/role.service';
import type { Grant } from './authorization/scope';
import { AuditService } from '../audit/audit.service';
import type { RequestContextService } from '../../common/context/request-context.service';

describe('access control (database)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let authz: AuthorizationService;
  const ACTOR = uuidv7();
  // Thin adapters so the scenarios read naturally; the actor id is only recorded in audit rows.
  let roles: {
    createCustom: (a: Grant[], i: CustomRoleInput) => ReturnType<RoleService['createCustom']>;
    updateCustom: (
      a: Grant[],
      id: string,
      p: Partial<CustomRoleInput>,
    ) => ReturnType<RoleService['updateCustom']>;
    deleteCustom: (id: string) => Promise<void>;
    clone: (a: Grant[], id: string, name: string) => ReturnType<RoleService['clone']>;
  };
  let assignments: {
    grant: (a: Grant[], i: GrantInput, by: string) => ReturnType<AssignmentService['grant']>;
    revoke: (a: Grant[], id: string) => Promise<void>;
  };

  const ids = {
    brandA: uuidv7(),
    brandB: uuidv7(),
    marketA: uuidv7(),
    marketB: uuidv7(),
    branchX: uuidv7(),
    branchY: uuidv7(),
    ae: uuidv7(),
  };

  const staff = async (email: string, status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE') =>
    // Fixtures never log in; the placeholder only satisfies the active-needs-password constraint.
    owner.staffUser.create({
      data: { email, fullName: email, status, passwordHash: 'fixture-no-login' },
    });

  const systemRole = (key: string) => owner.role.findUniqueOrThrow({ where: { systemKey: key } });

  const customRole = async (name: string, permissions: string[]) =>
    owner.role.create({
      data: {
        name,
        kind: 'CUSTOM',
        permissions: { create: permissions.map((permissionKey) => ({ permissionKey })) },
      },
    });

  const assign = (
    staffUserId: string,
    roleId: string,
    scope: { brandId?: string; marketId?: string; branchId?: string } = {},
    extra: { revokedAt?: Date; expiresAt?: Date } = {},
  ) => owner.staffRoleAssignment.create({ data: { staffUserId, roleId, ...scope, ...extra } });

  beforeAll(async () => {
    owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: testOwnerUrl() }) });
    app = new PrismaClient({ adapter: new PrismaPg({ connectionString: testAppUrl() }) });
    const prisma = { client: app } as unknown as PrismaService;
    authz = new AuthorizationService(prisma);
    const context = {
      actor: { type: 'system' },
      requestId: 'unknown',
    } as unknown as RequestContextService;
    const audit = new AuditService(prisma, context);
    const roleService = new RoleService(prisma, audit);
    const assignmentService = new AssignmentService(prisma, audit);
    roles = {
      createCustom: (a, i) => roleService.createCustom(a, i, ACTOR),
      updateCustom: (a, id, p) => roleService.updateCustom(a, id, p, ACTOR),
      deleteCustom: (id) => roleService.deleteCustom(id, ACTOR),
      clone: (a, id, n) => roleService.clone(a, id, n, ACTOR),
    };
    assignments = {
      grant: (a, i, by) => assignmentService.grant(a, i, by),
      revoke: (a, id) => assignmentService.revoke(a, id, ACTOR),
    };
    await syncAccessControl(owner);
  });

  afterAll(async () => {
    await owner.$executeRawUnsafe('DELETE FROM staff_role_assignment');
    await owner.$executeRawUnsafe('DELETE FROM staff_user');
    await owner.role.deleteMany({ where: { kind: 'CUSTOM' } });
    await owner.$executeRawUnsafe('TRUNCATE brand, branch, delivery_area CASCADE');
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  beforeEach(async () => {
    await owner.$executeRawUnsafe('DELETE FROM staff_role_assignment');
    await owner.$executeRawUnsafe('DELETE FROM staff_user');
    await owner.role.deleteMany({ where: { kind: 'CUSTOM' } });
    await owner.$executeRawUnsafe('TRUNCATE brand, branch, delivery_area CASCADE');
    await owner.country.deleteMany({ where: { iso2: 'AE' } });
    await owner.country.create({
      data: { id: ids.ae, iso2: 'AE', iso3: 'ARE', name: 'United Arab Emirates' },
    });
    await withScope(owner, { brandIds: [], platform: true }, async (tx) => {
      await tx.brand.createMany({
        data: [
          { id: ids.brandA, slug: 'brand-a', name: 'A' },
          { id: ids.brandB, slug: 'brand-b', name: 'B' },
        ],
      });
      await tx.market.createMany({
        data: [
          {
            id: ids.marketA,
            brandId: ids.brandA,
            countryId: ids.ae,
            code: 'ae',
            timezone: 'Asia/Dubai',
          },
          {
            id: ids.marketB,
            brandId: ids.brandB,
            countryId: ids.ae,
            code: 'ae',
            timezone: 'Asia/Dubai',
          },
        ],
      });
      await tx.branch.createMany({
        data: [
          { id: ids.branchX, code: 'x', name: 'X', countryId: ids.ae, timezone: 'Asia/Dubai' },
          { id: ids.branchY, code: 'y', name: 'Y', countryId: ids.ae, timezone: 'Asia/Dubai' },
        ],
      });
      await tx.branchMarket.createMany({
        data: [
          { branchId: ids.branchX, marketId: ids.marketA, countryId: ids.ae },
          { branchId: ids.branchY, marketId: ids.marketB, countryId: ids.ae },
        ],
      });
    });
  });

  describe('catalog and system roles', () => {
    it('sync is idempotent and matches the code', async () => {
      await syncAccessControl(owner);
      await syncAccessControl(owner);
      expect(await owner.permission.count()).toBe(PERMISSION_CATALOG.length);
      expect(await owner.role.count({ where: { kind: 'SYSTEM' } })).toBe(12);
      for (const t of ROLE_TEMPLATES) {
        const role = await owner.role.findUniqueOrThrow({
          where: { systemKey: t.systemKey },
          include: { permissions: true },
        });
        expect(role.permissions.map((p) => p.permissionKey).sort()).toEqual(
          [...t.permissions].sort(),
        );
      }
    });

    it('removes permissions that left the catalog from every role', async () => {
      await owner.permission.create({
        data: { key: 'legacy.thing', groupName: 'legacy', description: 'old' },
      });
      const custom = await customRole('Legacy holder', ['legacy.thing', 'orders.view']);
      await syncAccessControl(owner);
      expect(await owner.permission.findUnique({ where: { key: 'legacy.thing' } })).toBeNull();
      const perms = await owner.rolePermission.findMany({ where: { roleId: custom.id } });
      expect(perms.map((p) => p.permissionKey)).toEqual(['orders.view']);
    });

    it('is read-only for the runtime role (permissions and system roles)', async () => {
      const sa = await systemRole(SUPER_ADMIN_SYSTEM_KEY);
      await expect(
        app.role.update({ where: { id: sa.id }, data: { name: 'Hacked' } }),
      ).rejects.toThrow();
      await expect(app.role.delete({ where: { id: sa.id } })).rejects.toThrow();
      await expect(app.rolePermission.deleteMany({ where: { roleId: sa.id } })).rejects.toThrow();
      await expect(
        app.role.create({ data: { name: 'Fake', kind: 'SYSTEM', systemKey: 'fake' } }),
      ).rejects.toThrow();
      await expect(
        app.permission.create({ data: { key: 'x.y', groupName: 'x', description: 'x' } }),
      ).rejects.toThrow();
      expect((await systemRole(SUPER_ADMIN_SYSTEM_KEY)).name).toBe('Super Admin');
    });
  });

  describe('grants', () => {
    it('ignores revoked, expired and suspended-staff assignments', async () => {
      const role = await customRole('Viewer', ['orders.view']);
      const active = await staff('active@example.test');
      await assign(active.id, role.id, { brandId: ids.brandA });
      await assign(active.id, role.id, { brandId: ids.brandB }, { revokedAt: new Date() });
      await assign(active.id, role.id, {}, { expiresAt: new Date(Date.now() - 1000) });
      const grants = await authz.loadGrants(active.id);
      expect(grants).toHaveLength(1);
      expect(grants[0]?.scope).toMatchObject({ brandId: ids.brandA });

      const suspended = await staff('suspended@example.test', 'SUSPENDED');
      await assign(suspended.id, role.id);
      expect(await authz.loadGrants(suspended.id)).toEqual([]);
    });

    it('derives the database scope from grants (platform, brand, branch-only)', async () => {
      const role = await customRole('Viewer', ['orders.view']);
      const s = await staff('scope@example.test');
      await assign(s.id, role.id, { branchId: ids.branchY });
      await assign(s.id, role.id, { brandId: ids.brandA });
      expect(await authz.dbScopeFor(await authz.loadGrants(s.id), 'orders.view')).toEqual({
        brandIds: expect.arrayContaining([ids.brandA, ids.brandB]),
      });
      expect(await authz.dbScopeFor(await authz.loadGrants(s.id), 'orders.cancel')).toEqual({
        brandIds: [],
      });
      await assign(s.id, role.id);
      expect(await authz.dbScopeFor(await authz.loadGrants(s.id), 'orders.view')).toEqual({
        brandIds: [],
        platform: true,
      });
    });
  });

  describe('custom roles', () => {
    const superAdminGrants = async () => {
      const s = await staff('root@example.test');
      await assign(s.id, (await systemRole(SUPER_ADMIN_SYSTEM_KEY)).id);
      return authz.loadGrants(s.id);
    };

    it('creates, updates, clones and deletes custom roles', async () => {
      const actor = await superAdminGrants();
      const role = await roles.createCustom(actor, {
        name: 'Shop helper',
        permissions: ['orders.view'],
      });
      await roles.updateCustom(actor, role.id, { permissions: ['orders.view', 'orders.edit'] });
      const perms = await owner.rolePermission.findMany({ where: { roleId: role.id } });
      expect(perms.map((p) => p.permissionKey).sort()).toEqual(['orders.edit', 'orders.view']);

      const copy = await roles.clone(
        actor,
        (await systemRole('order_coordinator')).id,
        'Coordinator+',
      );
      expect(copy.kind).toBe('CUSTOM');
      await roles.deleteCustom(copy.id);
      expect(await owner.role.findUnique({ where: { id: copy.id } })).toBeNull();
    });

    it('rejects duplicate names, unknown permissions and system role edits', async () => {
      const actor = await superAdminGrants();
      await roles.createCustom(actor, { name: 'Dup', permissions: ['orders.view'] });
      await expect(
        roles.createCustom(actor, { name: 'dup', permissions: ['orders.view'] }),
      ).rejects.toMatchObject({ code: 'ROLE_NAME_TAKEN' });
      await expect(
        roles.createCustom(actor, { name: 'Bad', permissions: ['no.such'] }),
      ).rejects.toMatchObject({ code: 'UNKNOWN_PERMISSION' });
      const sys = await systemRole('branch_manager');
      await expect(roles.updateCustom(actor, sys.id, { name: 'x' })).rejects.toMatchObject({
        code: 'SYSTEM_ROLE_IMMUTABLE',
      });
      await expect(roles.deleteCustom(sys.id)).rejects.toMatchObject({
        code: 'SYSTEM_ROLE_IMMUTABLE',
      });
    });

    it('stops privilege escalation through role definitions', async () => {
      const limited = await staff('limited@example.test');
      await assign(limited.id, await customRole('Limited', ['orders.view']).then((r) => r.id));
      const actor = await authz.loadGrants(limited.id);
      await expect(
        roles.createCustom(actor, {
          name: 'Grabby',
          permissions: ['orders.view', 'refunds.approve'],
        }),
      ).rejects.toMatchObject({ code: 'ESCALATION_DENIED' });
      await expect(
        roles.clone(actor, (await systemRole(SUPER_ADMIN_SYSTEM_KEY)).id, 'Super copy'),
      ).rejects.toMatchObject({ code: 'ESCALATION_DENIED' });
    });

    it('refuses to delete a role that is still assigned', async () => {
      const actor = await superAdminGrants();
      const role = await roles.createCustom(actor, {
        name: 'In use',
        permissions: ['orders.view'],
      });
      const s = await staff('user@example.test');
      await assign(s.id, role.id);
      await expect(roles.deleteCustom(role.id)).rejects.toMatchObject({ code: 'ROLE_IN_USE' });
    });
  });

  describe('audit trail', () => {
    const trail = (targetId: string) =>
      withScope(owner, { brandIds: [], platform: true }, (tx) =>
        tx.auditLog.findMany({ where: { targetId }, orderBy: { id: 'asc' } }),
      );

    it('records role changes and assignment grant/revoke with the acting staff member', async () => {
      const root = await staff('audit-root@example.test');
      const saRole = await systemRole(SUPER_ADMIN_SYSTEM_KEY);
      await assign(root.id, saRole.id);
      const spare = await staff('audit-spare@example.test');
      await assign(spare.id, saRole.id);
      const actor = await authz.loadGrants(root.id);

      const role = await roles.createCustom(actor, {
        name: 'Audited',
        permissions: ['orders.view'],
      });
      await roles.updateCustom(actor, role.id, { permissions: ['orders.view', 'orders.edit'] });
      await roles.deleteCustom(role.id);
      expect((await trail(role.id)).map((r) => r.action)).toEqual([
        'role.create',
        'role.update',
        'role.delete',
      ]);
      const update = (await trail(role.id))[1];
      expect(update?.actorType).toBe('STAFF');
      expect(update?.before).toMatchObject({ permissions: ['orders.view'] });
      expect(update?.after).toMatchObject({ permissions: ['orders.edit', 'orders.view'] });

      const target = await staff('audit-target@example.test');
      const viewer = await customRole('Audit viewer', ['orders.view']);
      const granted = await assignments.grant(
        actor,
        { staffUserId: target.id, roleId: viewer.id, brandId: ids.brandA },
        root.id,
      );
      await assignments.revoke(actor, granted.id);
      const rows = await trail(target.id);
      expect(rows.map((r) => r.action)).toEqual(['assignment.grant', 'assignment.revoke']);
      expect(rows.every((r) => r.brandId === ids.brandA)).toBe(true);
    });

    it('writes no audit row when the audited change is refused', async () => {
      const limited = await staff('audit-limited@example.test');
      await assign(limited.id, (await customRole('Audit limited', ['orders.view'])).id);
      const actor = await authz.loadGrants(limited.id);
      await expect(
        roles.createCustom(actor, { name: 'Audit grab', permissions: ['refunds.approve'] }),
      ).rejects.toMatchObject({ code: 'ESCALATION_DENIED' });
      const rows = await withScope(owner, { brandIds: [], platform: true }, (tx) =>
        tx.auditLog.count({
          where: { action: 'role.create', after: { path: ['name'], equals: 'Audit grab' } },
        }),
      );
      expect(rows).toBe(0);
    });
  });

  describe('assignments', () => {
    const managerOf = async (scope: { brandId?: string }) => {
      const mgr = await staff(`mgr-${Math.random()}@example.test`);
      const role = await customRole(`Mgr ${Math.random()}`, ['users.manage', 'orders.view']);
      await assign(mgr.id, role.id, scope);
      return { mgr, actor: await authz.loadGrants(mgr.id) };
    };

    it('lets a brand manager assign only inside their brand and only what they hold', async () => {
      const { mgr, actor } = await managerOf({ brandId: ids.brandA });
      const target = await staff('target@example.test');
      const viewer = await customRole('Order viewer', ['orders.view']);
      await expect(
        assignments.grant(
          actor,
          { staffUserId: target.id, roleId: viewer.id, brandId: ids.brandA },
          mgr.id,
        ),
      ).resolves.toBeDefined();
      await expect(
        assignments.grant(
          actor,
          { staffUserId: target.id, roleId: viewer.id, brandId: ids.brandB },
          mgr.id,
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        assignments.grant(actor, { staffUserId: target.id, roleId: viewer.id }, mgr.id),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      const canceller = await customRole('Canceller', ['orders.cancel']);
      await expect(
        assignments.grant(
          actor,
          { staffUserId: target.id, roleId: canceller.id, brandId: ids.brandA },
          mgr.id,
        ),
      ).rejects.toMatchObject({ code: 'ESCALATION_DENIED' });
    });

    it('rejects inconsistent brand/market/branch scopes', async () => {
      const root = await staff('root2@example.test');
      await assign(root.id, (await systemRole(SUPER_ADMIN_SYSTEM_KEY)).id);
      const actor = await authz.loadGrants(root.id);
      const target = await staff('t2@example.test');
      const role = await customRole('Viewer 2', ['orders.view']);
      const bad = [
        { brandId: ids.brandA, marketId: ids.marketB },
        { marketId: ids.marketA },
        { brandId: ids.brandA, branchId: ids.branchY },
        { marketId: ids.marketA, brandId: ids.brandA, branchId: ids.branchY },
      ];
      for (const scope of bad) {
        await expect(
          assignments.grant(actor, { staffUserId: target.id, roleId: role.id, ...scope }, root.id),
        ).rejects.toMatchObject({ code: 'INVALID_SCOPE' });
      }
      await expect(
        assignments.grant(
          actor,
          {
            staffUserId: target.id,
            roleId: role.id,
            brandId: ids.brandA,
            marketId: ids.marketA,
            branchId: ids.branchX,
          },
          root.id,
        ),
      ).resolves.toBeDefined();
      await expect(
        assignments.grant(
          actor,
          { staffUserId: target.id, roleId: role.id, branchId: ids.branchY },
          root.id,
        ),
      ).resolves.toBeDefined();
    });

    it('never removes the last active Super Admin, even concurrently', async () => {
      const saRole = await systemRole(SUPER_ADMIN_SYSTEM_KEY);
      const first = await staff('sa1@example.test');
      const second = await staff('sa2@example.test');
      const a1 = await assign(first.id, saRole.id);
      const actor = await authz.loadGrants(first.id);

      await expect(assignments.revoke(actor, a1.id)).rejects.toMatchObject({
        code: 'LAST_SUPER_ADMIN',
      });

      const a2 = await assign(second.id, saRole.id);
      const results = await Promise.allSettled([
        assignments.revoke(actor, a1.id),
        assignments.revoke(actor, a2.id),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toMatchObject({ code: 'LAST_SUPER_ADMIN' });
      const active = await owner.staffRoleAssignment.count({
        where: { roleId: saRole.id, revokedAt: null },
      });
      expect(active).toBe(1);
    });

    it('does not count scoped or suspended Super Admin assignments as protection', async () => {
      const saRole = await systemRole(SUPER_ADMIN_SYSTEM_KEY);
      const main = await staff('main@example.test');
      const suspended = await staff('susp@example.test', 'SUSPENDED');
      const scoped = await staff('scoped@example.test');
      const mainAssignment = await assign(main.id, saRole.id);
      await assign(suspended.id, saRole.id);
      await assign(scoped.id, saRole.id, { brandId: ids.brandA });
      const actor = await authz.loadGrants(main.id);
      await expect(assignments.revoke(actor, mainAssignment.id)).rejects.toMatchObject({
        code: 'LAST_SUPER_ADMIN',
      });
    });

    it('lets a scoped manager revoke only inside their scope', async () => {
      const { mgr, actor } = await managerOf({ brandId: ids.brandA });
      const role = await customRole('Viewer 3', ['orders.view']);
      const t = await staff('t3@example.test');
      const inB = await assign(t.id, role.id, { brandId: ids.brandB });
      await expect(assignments.revoke(actor, inB.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
      const inA = await assign(t.id, role.id, { brandId: ids.brandA });
      await expect(assignments.revoke(actor, inA.id)).resolves.toBeUndefined();
      void mgr;
    });
  });
});
