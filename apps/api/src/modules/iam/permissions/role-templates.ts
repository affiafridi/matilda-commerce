import { ALL_PERMISSION_KEYS, type CatalogPermission } from './catalog';

/**
 * The 12 system role templates (docs/ROLES-AND-PERMISSIONS.md). Default sets are PROPOSED and need the
 * owner's sign-off (D2-08) before production seeding. This file is the ONLY place that names system
 * roles; authorization never branches on a role name (a test enforces this).
 */
export interface RoleTemplate {
  readonly systemKey: string;
  readonly name: string;
  readonly description: string;
  readonly permissions: readonly CatalogPermission[];
}

export const SUPER_ADMIN_SYSTEM_KEY = 'super_admin';

export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    systemKey: SUPER_ADMIN_SYSTEM_KEY,
    name: 'Super Admin',
    description: 'Full management across all brands, markets and branches.',
    permissions: ALL_PERMISSION_KEYS,
  },
  {
    systemKey: 'operations_manager',
    name: 'Operations Manager',
    description: 'Business operations for the assigned brands, markets and branches.',
    permissions: [
      'brands.view',
      'markets.view',
      'branches.view',
      'branches.manage',
      'users.view',
      'roles.view',
      'settings.view',
      'customers.view',
      'products.view',
      'orders.view',
      'orders.create',
      'orders.edit',
      'orders.cancel',
      'refunds.create',
      'production.view',
      'production.update',
      'inventory.view',
      'inventory.adjust',
      'inventory.transfer',
      'delivery.view',
      'delivery.manage',
      'delivery.assign',
      'reports.view',
    ],
  },
  {
    systemKey: 'branch_manager',
    name: 'Branch Manager',
    description: 'Daily operations of the assigned branches.',
    permissions: [
      'branches.view',
      'users.view',
      'customers.view',
      'products.view',
      'orders.view',
      'orders.create',
      'orders.edit',
      'production.view',
      'production.update',
      'inventory.view',
      'inventory.adjust',
      'delivery.view',
      'delivery.assign',
      'reports.view',
    ],
  },
  {
    systemKey: 'order_coordinator',
    name: 'Order Coordinator',
    description: 'Creates and manages website, WhatsApp and manual orders.',
    permissions: [
      'products.view',
      'orders.view',
      'orders.create',
      'orders.edit',
      'customers.view',
      'delivery.view',
    ],
  },
  {
    systemKey: 'production_staff',
    name: 'Production Staff',
    description: 'Prepares assigned orders (florists, chefs, bakers).',
    permissions: ['production.view', 'production.update', 'orders.view'],
  },
  {
    systemKey: 'catalog_manager',
    name: 'Catalog Manager',
    description: 'Products, categories, variations, add-ons and pricing.',
    permissions: [
      'products.view',
      'products.create',
      'products.edit',
      'products.delete',
      'products.publish',
      'pricing.edit',
      'media.manage',
      'inventory.view',
    ],
  },
  {
    systemKey: 'inventory_manager',
    name: 'Inventory Manager',
    description: 'Stock, raw materials, adjustments and transfers.',
    permissions: [
      'products.view',
      'inventory.view',
      'inventory.adjust',
      'inventory.transfer',
      'reports.view',
    ],
  },
  {
    systemKey: 'marketing_seo_manager',
    name: 'Marketing and SEO Manager',
    description: 'Campaigns, promotions, SEO, content and analytics.',
    permissions: [
      'products.view',
      'promotions.view',
      'promotions.manage',
      'seo.view',
      'seo.edit',
      'seo.publish',
      'cms.view',
      'cms.edit',
      'cms.publish',
      'media.manage',
      'reviews.moderate',
      'reports.view',
    ],
  },
  {
    systemKey: 'finance_manager',
    name: 'Finance Manager',
    description: 'Payments, invoices, refunds, reconciliation and financial reports.',
    permissions: [
      'orders.view',
      'finance.view',
      'finance.export',
      'refunds.create',
      'refunds.approve',
      'reports.view',
    ],
  },
  {
    systemKey: 'delivery_manager',
    name: 'Delivery Manager',
    description: 'Zones, slots, riders, assignments and delivery operations.',
    permissions: [
      'orders.view',
      'delivery.view',
      'delivery.manage',
      'delivery.assign',
      'reports.view',
    ],
  },
  {
    systemKey: 'delivery_rider',
    name: 'Delivery Rider',
    description: 'Assigned deliveries, status updates and proof of delivery.',
    permissions: ['delivery.view', 'delivery.update'],
  },
  {
    systemKey: 'customer_support',
    name: 'Customer Support',
    description: 'Enquiries, complaints and authorized order assistance.',
    permissions: ['orders.view', 'orders.edit', 'customers.view', 'refunds.create'],
  },
];
