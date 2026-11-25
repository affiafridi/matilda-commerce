# CMS and Marketing

## CMS [Approved]

Dynamic homepage sections; banners; promotional sections; landing pages; static pages; blog posts; navigation menus; footer management; media library; scheduled publishing; localized content; brand-specific content; market-specific campaigns. Rich text via TipTap (sanitized output); media in Cloudflare R2 with responsive/AVIF/WebP derivatives.

Content is brand-scoped and translated through the same translation architecture as products ([MULTILINGUAL](MULTILINGUAL.md)). Homepage is built from typed section blocks whose presentation is defined by the brand theme ([DESIGN-SYSTEM](DESIGN-SYSTEM.md)) — editors choose content, not arbitrary layout code.

## Marketing [Approved]

- Coupon codes; percentage and fixed discounts; free-delivery promotions.
- Product-, category- and cart-based promotions.
- Free gifts (automatically added based on cart conditions); bundle discounts.
- Scheduled campaigns; customer-specific offers.
- Abandoned cart recovery.
- Loyalty points; gift cards; referral programs.
- Birthday and anniversary reminders **with customer consent**.
- Advanced coupons (per Matilda Cake parity — [FEATURE-PARITY](FEATURE-PARITY.md)).

## Promotion engine [Proposed]

Rule-based: conditions (cart subtotal, items/categories, customer segment, delivery zone/date, first order, usage limits, schedule) → actions (discount, free delivery, add gift). Defined priority, stacking and exclusivity rules; usage counters in transactions; evaluated only by the backend pricing service ([CART-AND-CHECKOUT](CART-AND-CHECKOUT.md)). Per-brand and market scoped; coupon codes unique per brand.

## Loyalty and gift cards [Proposed]

Points ledger (earn/redeem/expire/adjust) per brand; gift card balances as a ledger with secure codes and fraud limits; whether points/gift cards are shared across brands is **[Open]** (default: brand-specific).

## Compliance

Marketing messages require recorded consent and opt-out ([NOTIFICATIONS](NOTIFICATIONS.md), [CUSTOMER-AUTH](CUSTOMER-AUTH.md)). Pixel/tag firing respects consent ([SEO](SEO.md)).

## Open

Referral reward mechanics; points value and expiry; gift card regulations in UAE; campaign approval workflow; blog authoring roles.
