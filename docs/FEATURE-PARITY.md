# Feature Parity Checklist (Matilda Cake and existing WooCommerce sites)

Status key: **Confirmed** (observed/stated by owner) · **Proposed** (engine will support) · **Requires verification** (must be audited).

## Audit status (Phase 0)

- **matildacake.com received a read-only public text audit on 2026-11-25** (homepage, shop, 2 product pages, 1 category page, shipping policy; nothing submitted or added to cart). Results are in "Observed on the Cake site" below. The checklist table's Status column is the *pre-audit* status from the owner's prompt; the observed section says which items were seen publicly. The fetch returned body text only (no HTML head, CSS, JSON-LD, robots/sitemap), and the homepage was partly summarized.
- Public pages never show everything: actual WooCommerce configuration, plugins, custom code and operational workflows **must be audited with admin access** before finalizing parity or migrating. Do not modify the existing sites.
- `matildaflower.com` (Flowers) homepage was fetched as text only; observations are noted below as Observed.

## Checklist: Matilda Cake requirements (from owner)

| # | Feature | Source | Engine support | Status |
|---|---|---|---|---|
| 1 | Cake flavors | Owner | Variation attribute | Requires verification |
| 2 | Cake sizes/weights | Owner | Variation attribute | Requires verification |
| 3 | Multiple variation combinations | Owner | Variations ([PRODUCT-ENGINE](PRODUCT-ENGINE.md)) | Requires verification |
| 4 | Variation-based prices | Owner | Variation market prices | Requires verification |
| 5 | Custom cake message | Owner | Custom text option | Requires verification |
| 6 | Customer reference image upload | Owner | Upload option | Requires verification |
| 7 | Personalized product options | Owner | Options | Requires verification |
| 8 | Optional and required add-ons | Owner | Add-ons | Requires verification |
| 9 | Simple and variable add-on products | Owner | Add-ons | Requires verification |
| 10 | Cake + flower combinations | Owner | Bundles / cross-brand? | Requires verification — **cross-brand cart is [Open]** |
| 11 | Product-specific preparation times | Owner | Product ops rules ([DELIVERY](DELIVERY.md)) | Requires verification |
| 12 | Customized cake lead times | Owner | Option-driven lead time | Requires verification |
| 13 | Product-specific delivery restrictions | Owner | Restrictions | Requires verification |
| 14 | Category-specific delivery restrictions | Owner | Restrictions | Requires verification |
| 15 | Location-specific product restrictions | Owner | Restrictions | Requires verification |
| 16 | Conditional product options | Owner | Conditional rules | Requires verification |
| 17 | Delivery date and time selection | Owner | Slots | Requires verification |
| 18 | Same-day / next-day delivery rules | Owner | Cutoffs | Requires verification |
| 19 | Minimum order lead times | Owner | Lead times | Requires verification |
| 20 | Configurable delivery cutoff times | Owner | Cutoffs | Requires verification |
| 21 | Automatically added promotional gifts | Owner | Promotions | Requires verification |
| 22 | Free products based on cart conditions | Owner | Promotions | Requires verification |
| 23 | Advanced coupons | Owner | Promotions/coupons | Requires verification |
| 24 | Order-specific instructions | Owner | Order notes | Requires verification |
| 25 | WhatsApp ordering workflows | Owner | Manual orders; WhatsApp notifications | Requires verification |
| 26 | Customer order tracking | Owner | Tracking | Requires verification |
| 27 | Manual order entry | Owner | Manual orders | Requires verification |
| 28 | Multiple branch operations | Owner | Branches | Requires verification |

## Observed on the Flowers site (text-only fetch, `matildaflower.com`)

| Observation | Status |
|---|---|
| WordPress paths (`/wp-content/`, `/product/`); likely WooCommerce ("Add to Cart", "Select Options") | Observed; WooCommerce not explicitly confirmed |
| English only; prices in AED | Observed |
| Piece-count variations (e.g., 6–51 pcs) with price ranges | Observed |
| Greeting cards sold as separate products (AED 15) | Observed |
| "Delivered Anywhere in Dubai", free delivery | Observed (headline); terms unverified |
| Phone and WhatsApp ordering links | Observed (phone); WhatsApp from summary only |
| Menu taxonomy: Occasions, Seasons, Emotions, Zodiac Blooms, Signature (collections), Our Story | Observed — implies strong **collections/taxonomy** needs |
| Footer legal entity (Matilda Cakes and Sweets L.L.C.) | Unverified summary |
| Payment methods, checkout steps, delivery slots, plugins, coupons | Requires verification |

## Observed on the Cake site (`matildacake.com`, public text audit)

| Area | Observation | Maps to checklist # | Status |
|---|---|---|---|
| Platform | WordPress media paths; `/product/`, `/product-category/`, `/my-account/` URLs; "Original price was…" strings consistent with WooCommerce; skip-link IDs suggest Bricks Builder theme; images via a CDN pull zone; no plugin paths seen | — | Likely WooCommerce, **unconfirmed**; plugins unknown |
| Variations | Pink Teddy Cake: Flavor (Chocolate/Vanilla) and Size (1.2kg / 750 g) dropdowns; price ranges shown ("AED 199 – AED 305") | 1–4 | **Confirmed** (public) |
| Delivery date/time | "Delivery Date *" and "Delivery Time *" required on product page; time-slot selector | 17 | **Confirmed** |
| Order hours | "Orders are accepted daily from 9:00 AM – 11:45 PM only" | 20 | Confirmed (text); cutoff logic unknown |
| Same-day delivery | Copy mentions same-day delivery across the UAE | 18 | Confirmed (marketing copy); rules unknown |
| Add-ons | "Customize Your Order" add-on modal with "Skip add-ons & continue" (optional add-ons) | 8, 9 | **Confirmed** (modal); variable add-ons unknown |
| Buy flow | "Buy Now" button on product pages, slide-out cart | — | Observed |
| Sale pricing | Strike-through sale price (e.g., AED 800 → 640) | — | Confirmed |
| Coupons | Site banner: code UAE15, 15% off until 30 Nov | 23 | Confirmed (one coupon); advanced rules unknown |
| Shipping | Flat rate or free shipping in Dubai depending on order value; rates vary by Emirate; extra charge for midnight delivery; pickup Mon–Sun 10am–6pm, ready within ~1 hour | 13–15 | Confirmed (policy text); amounts/thresholds not observable |
| Filters | Shop filters by flavor, size, price, category; 39 shop pages | — | Observed |
| Reviews | Star ratings with counts on listings (e.g., 5 (78)) | — | Confirmed |
| Contact | Phone, email, WhatsApp click-to-chat with prefilled text, a second WhatsApp number labelled "AI Assistant" | 25 | Confirmed; workflow unknown |
| Branch | One address: International City, Dubai; no other branches seen | 28 | Public view shows one; multi-branch ops **unverified** |
| Language/currency | English with an Arabic greeting banner, no language switcher; AED | — | Observed |
| Pages | Shipping, refund, billing terms, privacy, contact, blogs, my-account | — | Observed |
| Message on cake, reference image upload, conditional fields | Not visible on the two products read | 5–7, 16 | **Not observable** — need admin/other product audit |
| Lead times, product/category/area restrictions, cutoffs by product | Not observable | 11–15, 19 | Requires verification |
| Free gifts / auto-added products | Not observable | 21, 22 | Requires verification |
| Order tracking | No link found in header/footer/policy | 26 | Requires verification |
| Payment methods | "Secure Payment" text only | — | Requires verification |
| SEO | Titles seen (e.g., "Cakes in Dubai | Delicious Cakes for All Special Occasions"); meta, canonical, schema, sitemap, robots not observable | — | Requires verification |

### Findings that affect the design

- **Navigation is campaign- and occasion-driven** (Flork, Valentine's, Kids, Red Velvet, Gender Reveal, Occasions) and some menu labels point to differently named category URLs (e.g., "Valentine's" → `/product-category/anniversary/`, "Christmas Cakes" → `/product-category/new-year/`). Confirms the need for **collections separate from categories**, and per-brand navigation menus editable by marketing. Slug/label mismatches are an SEO-migration concern.
- **Delivery date and time are chosen on the product page**, not only at checkout. The storefront needs a date/slot picker on the product page backed by the delivery availability API ([DELIVERY](DELIVERY.md)).
- **Shipping varies by Emirate and order value, with midnight surcharges**: delivery charges need rules by zone, order value and time slot.
- **Cake and flower cross-selling already exists** ("Order Cakes & Flowers" in the shop title; a flower-related combo). Cross-brand cart/bundle is still **[Open]** ([DECISIONS](DECISIONS.md) item 7).
- **Existing URL patterns** (`/product/{slug}/`, `/product-category/{slug}/`) must be preserved or 301-mapped ([SEO](SEO.md)).
- The legal entity in the Cake address footer matches the Flowers footer (Matilda Cakes and Sweets L.L.C.), supporting one shared entity across brands (still to confirm with finance).

## Items to audit with admin access [Required before Phase 11]

WooCommerce version and theme; every active plugin (product add-ons, delivery date, coupons, gift, WhatsApp, payment, SEO plugin — Yoast/Rank Math); custom code (functions.php, mu-plugins); product data model and exports; customers and order history volume; coupon rules; delivery configuration; CCAvenue plugin setup; redirects and URL structure; email templates; analytics/pixel setup; manual operations by staff (WhatsApp/phone workflow); reports used daily.

## Cookies by Matilda (`cookiesbymatilda.com`)

Not reviewed. Requires audit in Phase 11.

## Parity process

Audit → build a verified feature inventory → mark each as keep / improve / drop (owner decision) → map to engine capability → regression tests ([TESTING](TESTING.md)) → migration plan ([ROADMAP](ROADMAP.md) Phase 11).
