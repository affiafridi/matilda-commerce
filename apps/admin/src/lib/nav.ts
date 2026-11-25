/**
 * Navigation model (docs/design/admin-brief.html section 3). Items appear only when the module
 * exists (`built`) and the person holds the permission in at least one assignment. This is a
 * convenience: every API call is still authorized by the server.
 */
export type NavIcon =
  'home' | 'brands' | 'markets' | 'branches' | 'customers' | 'employees' | 'roles' | 'audit';

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: NavIcon;
  /** Permission needed to see the item; omitted = every signed-in staff member. */
  permission?: string;
  /** False until the screen ships (Phase 2 step 2.10); unbuilt items are never rendered. */
  built: boolean;
}

export interface NavGroup {
  id: string;
  label: string | null;
  items: NavItem[];
}

export const NAV: readonly NavGroup[] = [
  {
    id: 'main',
    label: null,
    items: [{ id: 'home', label: 'Home', href: '/', icon: 'home', built: true }],
  },
  {
    id: 'operations',
    label: 'Operations',
    items: [
      {
        id: 'brands',
        label: 'Brands and domains',
        href: '/brands',
        icon: 'brands',
        permission: 'brands.view',
        built: true,
      },
      {
        id: 'markets',
        label: 'Markets',
        href: '/markets',
        icon: 'markets',
        permission: 'markets.view',
        built: true,
      },
      {
        id: 'branches',
        label: 'Branches',
        href: '/branches',
        icon: 'branches',
        permission: 'branches.view',
        built: true,
      },
    ],
  },
  {
    id: 'commerce',
    label: 'Commerce',
    items: [
      {
        id: 'customers',
        label: 'Customers',
        href: '/customers',
        icon: 'customers',
        permission: 'customers.view',
        built: true,
      },
    ],
  },
  {
    id: 'administration',
    label: 'Administration',
    items: [
      {
        id: 'employees',
        label: 'Employees',
        href: '/employees',
        icon: 'employees',
        permission: 'users.view',
        built: true,
      },
      {
        id: 'roles',
        label: 'Roles and permissions',
        href: '/roles',
        icon: 'roles',
        permission: 'roles.view',
        built: true,
      },
      {
        id: 'audit',
        label: 'Audit log',
        href: '/audit-log',
        icon: 'audit',
        permission: 'audit.view',
        built: true,
      },
    ],
  },
];

export function visibleNav(
  held: ReadonlySet<string>,
  groups: readonly NavGroup[] = NAV,
): NavGroup[] {
  return groups
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => i.built && (!i.permission || held.has(i.permission))),
    }))
    .filter((g) => g.items.length > 0);
}
