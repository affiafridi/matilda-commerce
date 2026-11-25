# Centralized Admin Panel

A professional, enterprise-quality commerce management product (Shopify Admin as a usability/IA inspiration — no copying of branding). One admin app serves all brands, markets and branches.

## Context switching [Approved]

Switchers for authorized **Brand**, **Country/Market** and **Branch**. Navigation shows only modules the employee has permissions for (convenience only; the API enforces permissions and scope). Super Admin can view individual or combined business data (combined views assembled by the backend).

## Modules (complete long-term scope) [Approved]

| Group | Modules |
|---|---|
| Overview | Dashboard, Analytics, Notifications |
| Commerce | Orders, Products, Categories, Collections, Attributes, Variations, Customization options, Add-ons, Bundles, Inventory, Customers, Reviews, Abandoned carts |
| Operations | Brands, Countries and markets, Branches, Production, Delivery management, Delivery zones, Delivery slots, Riders |
| Marketing and Content | Campaigns, Coupons, Promotions, SEO Manager, CMS pages, Blogs, Media library, Homepage management, Banners, Navigation menus, Translations, Loyalty, Rewards, Gift cards |
| Finance | Transactions, Payments, Invoices, Refunds, Expenses, Financial reconciliation, Sales reports, Financial reports |
| Administration | Employees, Roles, Permissions, Integrations, Notification templates, Brand settings, Market settings, Branch settings, Activity logs, Audit logs, System health, Backup management |

**Not every module is built in the first phase** — see [ROADMAP](ROADMAP.md) for sequencing.

## UX priorities [Approved]

Logical navigation; clear hierarchy; professional data tables (TanStack Table) with advanced filters, search, saved views and bulk actions; consistent forms (React Hook Form + Zod); efficient variation management; clear brand/market/branch switchers; useful analytics; compact, readable layouts; proper dialogs; confirmation for destructive actions; loading, empty, error and success states; accessible interactions.

Do **not** turn every section into oversized cards. Use tables, forms, lists, tabs, drawers and panels per purpose ([DESIGN-SYSTEM](DESIGN-SYSTEM.md)).

## Focused interfaces

Production staff and Delivery Riders get simplified, task-focused, mobile-friendly views of the same backend ([ORDER-MANAGEMENT](ORDER-MANAGEMENT.md), [DELIVERY](DELIVERY.md)). Separate apps vs routes inside admin: **[Open]**.

## Security [Approved]

Staff 2FA, session management/revocation, step-up auth for sensitive actions (payments settings, refunds approval, role changes, exports), full audit logging ([SECURITY](SECURITY.md), [ROLES-AND-PERMISSIONS](ROLES-AND-PERMISSIONS.md)).

## Real-time

Socket.IO only where needed (e.g., new-order alerts, production board) — [TECH-STACK](TECH-STACK.md).
