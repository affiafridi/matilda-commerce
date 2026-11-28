import {
  ALL_PERMISSION_KEYS,
  PERMISSION_CATALOG,
  isCatalogPermission,
  isSensitivePermission,
} from './catalog';
import { ROLE_TEMPLATES, SUPER_ADMIN_SYSTEM_KEY } from './role-templates';

describe('permission catalog', () => {
  it('has unique, well-formed resource.action keys', () => {
    const keys = PERMISSION_CATALOG.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
  });

  it('has the Phase 5 commerce keys, with payment gateway changes sensitive', () => {
    for (const k of ['orders.view', 'promotions.view', 'promotions.manage', 'payments.view']) {
      expect(isCatalogPermission(k)).toBe(true);
    }
    expect(isSensitivePermission('payments.view')).toBe(false);
    expect(isSensitivePermission('settings.manage_payments')).toBe(true);
  });

  it('flags the sensitive keys named in the plan', () => {
    for (const k of [
      'refunds.approve',
      'settings.manage_payments',
      'finance.export',
      'roles.manage',
      'users.manage',
    ]) {
      expect(isSensitivePermission(k)).toBe(true);
    }
    expect(isSensitivePermission('products.view')).toBe(false);
    expect(isCatalogPermission('nope.nope')).toBe(false);
  });
});

describe('catalog permissions (Phase 3)', () => {
  it('defines the catalog keys the product engine relies on', () => {
    for (const k of [
      'products.view',
      'products.create',
      'products.edit',
      'products.delete',
      'products.publish',
      'pricing.edit',
      'taxonomy.manage',
      'media.manage',
    ]) {
      expect(isCatalogPermission(k)).toBe(true);
    }
  });

  it('grants catalog management only to the Catalog Manager and the Super Admin, read access more widely', () => {
    const holders = (key: string) =>
      ROLE_TEMPLATES.filter((t) => (t.permissions as readonly string[]).includes(key)).map(
        (t) => t.systemKey,
      );
    for (const key of ['products.create', 'products.edit', 'products.delete', 'taxonomy.manage']) {
      expect(holders(key).sort()).toEqual(['catalog_manager', SUPER_ADMIN_SYSTEM_KEY].sort());
    }
    expect(holders('pricing.edit').sort()).toEqual(
      ['catalog_manager', SUPER_ADMIN_SYSTEM_KEY].sort(),
    );
    expect(holders('products.publish').sort()).toEqual(
      ['catalog_manager', SUPER_ADMIN_SYSTEM_KEY].sort(),
    );
    expect(holders('products.view')).toEqual(
      expect.arrayContaining(['branch_manager', 'catalog_manager', 'inventory_manager']),
    );
  });
});

describe('role templates', () => {
  const byKey = new Map(ROLE_TEMPLATES.map((t) => [t.systemKey, t]));

  it('defines exactly the 12 approved roles with unique keys and names', () => {
    expect(ROLE_TEMPLATES).toHaveLength(12);
    expect(byKey.size).toBe(12);
    expect(new Set(ROLE_TEMPLATES.map((t) => t.name)).size).toBe(12);
  });

  it('only references catalog permissions, without duplicates', () => {
    for (const t of ROLE_TEMPLATES) {
      expect(new Set(t.permissions).size).toBe(t.permissions.length);
      for (const p of t.permissions) expect(isCatalogPermission(p)).toBe(true);
    }
  });

  it('gives the Super Admin template the whole catalog', () => {
    expect([...byKey.get(SUPER_ADMIN_SYSTEM_KEY)!.permissions].sort()).toEqual(
      [...ALL_PERMISSION_KEYS].sort(),
    );
  });

  it('keeps administration and payment secrets with the Super Admin by default', () => {
    for (const t of ROLE_TEMPLATES) {
      if (t.systemKey === SUPER_ADMIN_SYSTEM_KEY) continue;
      for (const p of [
        'roles.manage',
        'users.manage',
        'settings.manage_payments',
        'brands.manage',
        'integrations.manage',
      ]) {
        expect(t.permissions as readonly string[]).not.toContain(p);
      }
    }
  });

  it('keeps riders and production staff away from prices, customers and money', () => {
    for (const key of ['delivery_rider', 'production_staff']) {
      const perms = byKey.get(key)!.permissions as readonly string[];
      for (const p of ['pricing.edit', 'customers.view', 'finance.view', 'refunds.create']) {
        expect(perms).not.toContain(p);
      }
    }
  });

  it('separates refund approval from refund requests (finance only)', () => {
    const approvers = ROLE_TEMPLATES.filter((t) =>
      (t.permissions as readonly string[]).includes('refunds.approve'),
    ).map((t) => t.systemKey);
    expect(approvers.sort()).toEqual(['finance_manager', SUPER_ADMIN_SYSTEM_KEY].sort());
  });
});
