# Roles and Permissions

## Account categories [Approved]

Staff users and customers are logically separate: separate auth flows, tokens/cookies, guards and policies. Customers never reach staff functionality or other customers' records. Guest is an unauthenticated customer type, not a role ([CUSTOMER-AUTH](CUSTOMER-AUTH.md)).

## 12 predefined staff role templates [Approved]

| # | Role | Summary |
|---|---|---|
| 1 | Super Admin | Full management across all authorized brands, countries, branches |
| 2 | Operations Manager | Assigned brands/markets/branches and business operations |
| 3 | Branch Manager | Assigned branches, employees, daily operations |
| 4 | Order Coordinator | Create/manage website, WhatsApp and manual orders |
| 5 | Production Staff | Florists, chefs, bakers; prepare assigned orders |
| 6 | Catalog Manager | Products, categories, attributes, variations, add-ons, pricing |
| 7 | Inventory Manager | Stock, raw materials, adjustments, transfers |
| 8 | Marketing and SEO Manager | Campaigns, promotions, SEO, content, analytics |
| 9 | Finance Manager | Payments, invoices, refunds, reconciliation, financial reports |
| 10 | Delivery Manager | Zones, slots, riders, assignments, delivery operations |
| 11 | Delivery Rider | Assigned deliveries, navigation, status updates, proof of delivery |
| 12 | Customer Support | Enquiries, complaints, authorized order assistance |

These are **templates, not limits**: they seed default permission sets that can be cloned and edited.

## RBAC model [Approved + Proposed mechanics]

- Custom roles; granular permissions; **multiple role assignments per employee**.
- Each role assignment carries a **scope**: brand(s), market(s), branch(es) (or "all authorized").
- Effective access = union of permissions from assignments, evaluated **per target record's scope**.
- Authorization is by permission, never by role name.
- Permission-based navigation in the admin; but every API independently verifies permission and data scope.
- Activity and audit logs; permission/role changes tracked; sensitive financial/administrative actions need additional controls (re-authentication/2FA step-up, approval workflows) — [SECURITY](SECURITY.md).

## Permission naming [Approved examples]

`resource.action` format:

```text
products.view  products.create  products.edit  products.delete  products.publish
pricing.edit   taxonomy.manage (categories, collections, tags, attributes; added in Phase 3)
orders.view    orders.create    orders.edit    orders.cancel
refunds.create refunds.approve
seo.view seo.edit seo.publish
finance.view finance.export
settings.manage_payments
users.manage roles.manage
```

[Phase 4] `branches.calendar` (opening hours and closures) was added in step 4.1, and `delivery.manage` is sensitive (step-up). [Proposed] Additional families to define in Phase 2: inventory.*, delivery.*, production.*, customers.*, reviews.*, promotions.*, cms.*, media.*, notifications.*, reports.*, audit.view, integrations.manage, branches.manage, markets.manage, brands.manage.

## Proposed default emphasis per role [Proposed — validate with owner]

| Role | Typical permission families | Notes |
|---|---|---|
| Super Admin | all | Cannot be locked out; changes audited |
| Operations Manager | orders, delivery, production, inventory, reports, branches (scoped) | No payment secrets |
| Branch Manager | orders, production, inventory, employees (branch scope) | Branch-scoped only |
| Order Coordinator | orders.create/edit/view, customers.view | No refunds approval |
| Production Staff | production view/update for assigned orders | Focused UI; no pricing/customer PII beyond need |
| Catalog Manager | products.*, attributes, pricing | publish may be separate |
| Inventory Manager | inventory.*, transfers | |
| Marketing/SEO | promotions, seo.*, cms.*, analytics | seo.publish separable |
| Finance Manager | finance.*, refunds.approve, payments view | Export is audited |
| Delivery Manager | delivery.*, riders, assignments | |
| Delivery Rider | own assigned deliveries only | Record-level ownership |
| Customer Support | orders.view, limited orders.edit, customers.view | PII access logged |

## Open

Approval workflow thresholds (e.g., refund amount needing second approver); whether rider/production staff use the admin app or dedicated lightweight apps; staff SSO. See [DECISIONS](DECISIONS.md).
