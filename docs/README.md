# Matilda Commerce — Documentation Index

Status: **Phase 0 (Planning and Documentation).** No application code exists. Entry point for AI/engineers: [../CLAUDE.md](../CLAUDE.md).

## Labels used in every file

- **[Approved]** — stated by the owner in the master prompt.
- **[Proposed]** — suggested implementation detail, to be reviewed before build.
- **[Open]** — unresolved business/architecture question (collected in [DECISIONS.md](DECISIONS.md)).
- **[Assumption]** — recorded assumption, to be confirmed.

## Files

| File | Purpose |
|---|---|
| [PROJECT-OVERVIEW.md](PROJECT-OVERVIEW.md) | Business objectives, vision, brands, scope |
| [REQUIREMENTS.md](REQUIREMENTS.md) | Consolidated functional and non-functional requirements |
| [TECH-STACK.md](TECH-STACK.md) | Approved technologies and when they are introduced |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Modular monolith, app communication, scalability |
| [FOLDER-STRUCTURE.md](FOLDER-STRUCTURE.md) | Proposed monorepo layout (not yet created) |
| [DATABASE.md](DATABASE.md) | Proposed entities, constraints, isolation (not a final schema) |
| [API.md](API.md) | API surfaces, conventions, authorization |
| [MULTI-STORE.md](MULTI-STORE.md) | Brand → Market → Branch model |
| [ROLES-AND-PERMISSIONS.md](ROLES-AND-PERMISSIONS.md) | 12 role templates, RBAC, scopes |
| [CUSTOMER-AUTH.md](CUSTOMER-AUTH.md) | Registered customers and guests |
| [PRODUCT-ENGINE.md](PRODUCT-ENGINE.md) | Products, variations, add-ons, customization, bundles |
| [INVENTORY.md](INVENTORY.md) | Stock, reservations, transfers |
| [CART-AND-CHECKOUT.md](CART-AND-CHECKOUT.md) | Cart, pricing, checkout |
| [PAYMENTS.md](PAYMENTS.md) | Provider architecture, per-brand CCAvenue |
| [DELIVERY.md](DELIVERY.md) | Zones, slots, restrictions, assignment |
| [ORDER-MANAGEMENT.md](ORDER-MANAGEMENT.md) | Orders, production, state machines |
| [MULTILINGUAL.md](MULTILINGUAL.md) | English/Arabic, RTL, URL strategy |
| [ADMIN-PANEL.md](ADMIN-PANEL.md) | Admin modules and UX |
| [SEO.md](SEO.md) | Technical SEO and SEO Manager |
| [CMS-AND-MARKETING.md](CMS-AND-MARKETING.md) | Content, promotions, loyalty |
| [NOTIFICATIONS.md](NOTIFICATIONS.md) | Channels, templates, events |
| [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md) | UI/UX standards and prohibited patterns |
| [SECURITY.md](SECURITY.md) | Security and data protection |
| [PERFORMANCE.md](PERFORMANCE.md) | Caching, optimization, Web Vitals |
| [TESTING.md](TESTING.md) | QA strategy |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Infrastructure, CI/CD, backups |
| [FEATURE-PARITY.md](FEATURE-PARITY.md) | Matilda Cake / WooCommerce parity checklist |
| [ROADMAP.md](ROADMAP.md) | Phases 0–12 |
| [PROGRESS.md](PROGRESS.md) | Current status |
| [DECISIONS.md](DECISIONS.md) | Decision log and open questions |
| [CHANGELOG.md](CHANGELOG.md) | Important project changes |

## Suggested reading order

CLAUDE.md → PROJECT-OVERVIEW → ARCHITECTURE → MULTI-STORE → the domain file for the task → SECURITY → TESTING.
