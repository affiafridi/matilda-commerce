# Design System and UI/UX Standards

Permanent instructions. Act as a senior product designer, UI/UX specialist and frontend engineer experienced in premium international e-commerce and enterprise admin systems. **The result must never look generic, AI-generated or "vibe-coded".** Do not randomly change approved designs or established branding.

## Branding rules [Approved]

- Matilda Flower is the first storefront. Review the existing site, extract its authentic brand identity, logo, palette, typography, photography style, visual language, audience and product presentation; respect it while significantly improving design and UX. Do not copy the site.
- **Do not invent brand colors, logos or identities** if originals are unavailable; ask the owner for assets.
- Matilda Cake and Cookies by Matilda will get independent identities and themes.

### Current status of the brand review (Phase 0)

The Flowers site at `http://matildaflower.com` was read via text-only fetch: brand shown as "Matilda Flower" / "Matilda Flower Dubai", English only, AED prices, menus by Occasions / Seasons / Emotions / Zodiac Blooms / Signature. **Colors, fonts, logo artwork and photography style could not be observed.** Therefore:
- **Assets requested from owner:** logo files (SVG/PNG, light/dark), brand guidelines if any, font files/licences, color values, photography, Arabic wordmark if any, same for Cake and Cookies.
- A visual review in a real browser (screenshots) is required before tokens are defined — **[Open]**.
- The domain `matildaflowers.com` (with an "s") is a different site and is not a reference.

## Storefront direction [Approved]

Premium, elegant, sophisticated, refined, modern, trustworthy, visually balanced. Strong hierarchy; editorial-quality compositions; appropriate typography; consistent spacing; intentional whitespace; high-quality product photography; clear navigation; sophisticated product presentation; restrained animation (Motion); conversion-focused product pages; professional checkout; excellent mobile layouts. It should feel like a premium retail brand, not a SaaS template.

## Strictly avoid [Approved]

Excessive gradients · excessive rounded corners · unnecessary glassmorphism · glowing buttons · neon · excessive shadows · unnecessary pill shapes · random decorative icons · emojis as interface icons · cards inside cards · excessive badges · oversized headings without purpose · repetitive grid layouts · excessive animation · unnecessary floating elements · generic hero sections · default component-library styling · unnecessary borders and clutter. Every design decision needs a purpose. Never assemble pages from generic components without adapting them to the brand.

## Admin design [Approved]

Enterprise commerce management look: logical navigation, clear hierarchy, dense-but-readable tables, advanced filters, search, bulk actions, consistent forms, efficient variation management, clear switchers, useful analytics, compact layouts, proper dialogs, destructive-action confirmation, loading/empty/error/success states, accessible patterns. Tables, forms, lists, tabs, drawers and panels by purpose — not oversized cards ([ADMIN-PANEL](ADMIN-PANEL.md)).

## Design system contents [Approved]

Brand design tokens; color palettes; typography scales; spacing scales; border radius; buttons; form fields; dropdowns; dialogs; tables; navigation; product components; notifications; status indicators; loading states; empty states; responsive breakpoints; accessibility standards; RTL behavior.

### Architecture [Proposed]

- Three layers: **primitives** (`packages/ui`, unstyled/behavioral) → **brand tokens & themes** (`themes/{flowers,cakes,cookies}`: CSS variables via Tailwind preset, fonts, radius/shadow scale, layout variants) → **commerce components** (`packages/commerce`, presentation via tokens, no business rules).
- Brands can differ substantially in layout without duplicating commerce logic; shared functionality is separated from brand-specific presentation.
- Admin uses a neutral, separate token set (not brand-themed).
- shadcn/ui is a starting point and must be restyled to the admin design language; never ship defaults.

## Accessibility and responsiveness [Approved]

WCAG 2.2 AA; semantic HTML; keyboard navigation; accessible forms; adequate contrast; mobile-first responsive layouts; professional Arabic typography; complete RTL; reduced-motion support. Verified in [TESTING](TESTING.md).

## Process [Proposed]

For each storefront: brand audit → moodboard/type/color proposal for owner approval → tokens → key templates (home, listing, product, cart, checkout, account) approved in design before build. Approved designs are not changed without consent.
