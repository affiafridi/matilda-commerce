import { type PermissionKey, permissionKey } from '../permission-key';

/**
 * The single permission catalog (docs/ROLES-AND-PERMISSIONS.md). Keys for features that do not exist
 * yet are defined now so later phases only attach endpoints. Synced into the `permission` table by
 * `syncAccessControl`. Sensitive keys require step-up authentication (enforced from step 2.6).
 */
interface PermissionDef {
  readonly key: string;
  readonly group: string;
  readonly description: string;
  readonly sensitive?: true;
}

const def = (
  group: string,
  action: string,
  description: string,
  sensitive?: true,
): PermissionDef => ({
  key: `${group}.${action}`,
  group,
  description,
  ...(sensitive && { sensitive }),
});

export const PERMISSION_DEFS = [
  // Platform structure (functional in Phase 2)
  def('brands', 'view', 'View brands and their domains'),
  def('brands', 'manage', 'Create and edit brands and domains', true),
  def('markets', 'view', 'View markets'),
  def('markets', 'manage', 'Create and edit markets, currencies and languages', true),
  def('branches', 'view', 'View branches'),
  def('branches', 'manage', 'Create and edit branches and their market links', true),
  def('users', 'view', 'View staff users and their assignments'),
  def('users', 'manage', 'Invite, suspend and assign roles to staff', true),
  def('roles', 'view', 'View roles and permissions'),
  def('roles', 'manage', 'Create, edit, clone and delete custom roles', true),
  def('audit', 'view', 'View the audit log'),
  def('settings', 'view', 'View settings'),
  def('settings', 'manage', 'Change settings'),
  def('settings', 'manage_payments', 'Manage payment gateway configuration', true),
  def('customers', 'view', 'View customers'),
  def('customers', 'edit', 'Edit customer records'),
  // Catalog
  def('products', 'view', 'View products'),
  def('products', 'create', 'Create products'),
  def('products', 'edit', 'Edit products'),
  def('products', 'delete', 'Delete products'),
  def('products', 'publish', 'Publish and unpublish products'),
  def('pricing', 'edit', 'Edit prices'),
  // Orders and fulfilment
  def('orders', 'view', 'View orders'),
  def('orders', 'create', 'Create orders on behalf of customers'),
  def('orders', 'edit', 'Edit orders'),
  def('orders', 'cancel', 'Cancel orders'),
  def('refunds', 'create', 'Request refunds'),
  def('refunds', 'approve', 'Approve refunds', true),
  def('production', 'view', 'View production tasks'),
  def('production', 'update', 'Update production status'),
  def('inventory', 'view', 'View stock'),
  def('inventory', 'adjust', 'Adjust stock'),
  def('inventory', 'transfer', 'Transfer stock between branches'),
  def('delivery', 'view', 'View delivery configuration and assignments'),
  def('delivery', 'manage', 'Manage zones, slots and restrictions'),
  def('delivery', 'assign', 'Assign deliveries to riders'),
  def('delivery', 'update', 'Update status of assigned deliveries'),
  // Finance
  def('finance', 'view', 'View payments and financial reports'),
  def('finance', 'export', 'Export financial data', true),
  // Marketing and content
  def('promotions', 'view', 'View promotions'),
  def('promotions', 'manage', 'Manage promotions and coupons'),
  def('seo', 'view', 'View SEO data'),
  def('seo', 'edit', 'Edit SEO data'),
  def('seo', 'publish', 'Publish SEO changes'),
  def('cms', 'view', 'View content'),
  def('cms', 'edit', 'Edit content'),
  def('cms', 'publish', 'Publish content'),
  def('media', 'manage', 'Manage the media library'),
  def('reviews', 'moderate', 'Moderate reviews'),
  def('notifications', 'manage', 'Manage notification templates'),
  def('reports', 'view', 'View reports'),
  def('integrations', 'manage', 'Manage integrations and API credentials', true),
] as const satisfies readonly PermissionDef[];

export type CatalogPermission = (typeof PERMISSION_DEFS)[number]['key'];

export interface CatalogEntry {
  key: PermissionKey;
  group: string;
  description: string;
  sensitive: boolean;
}

export const PERMISSION_CATALOG: readonly CatalogEntry[] = PERMISSION_DEFS.map((d) => ({
  key: permissionKey(d.key),
  group: d.group,
  description: d.description,
  sensitive: 'sensitive' in d,
}));

export const ALL_PERMISSION_KEYS: readonly CatalogPermission[] = PERMISSION_DEFS.map((d) => d.key);

const KEYS = new Set<string>(ALL_PERMISSION_KEYS);
const SENSITIVE = new Set<string>(PERMISSION_CATALOG.filter((p) => p.sensitive).map((p) => p.key));

export const isCatalogPermission = (key: string): key is CatalogPermission => KEYS.has(key);
export const isSensitivePermission = (key: string): boolean => SENSITIVE.has(key);
