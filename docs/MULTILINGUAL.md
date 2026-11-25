# Multilingual and Localization

## Languages [Approved]

Initially **English and Arabic**. Storefront i18n via **next-intl**. Language availability is configured per market.

## Requirements [Approved]

- Complete English and Arabic UI; professional Arabic typography; proper RTL layouts (logical CSS properties, mirrored icons/directional components).
- Language switching; guest language preference; registered-customer language preference.
- Shared interface strings in translation files (`apps/storefront/src/i18n`, shared packages for common strings).
- **Database-driven translations** for products, categories, CMS, SEO metadata, notification templates. Do **not** duplicate products per language.
- Localized dates/times (market timezone), numbers and currency formatting.
- Language fallback (e.g., ar → en) with visible handling of missing translations.
- Admin must make translation status visible and editable ([ADMIN-PANEL](ADMIN-PANEL.md) Translations module).

## URL strategy [Proposed — must be reviewed before implementation]

```text
{brand-domain}/ae/en
{brand-domain}/ae/ar
{brand-domain}/sa/en
{brand-domain}/sa/ar
```

- Each language/market URL needs self-referencing canonical + full hreflang set (`en-AE`, `ar-AE`, `x-default`) — [SEO](SEO.md).
- **Critical:** Matilda Cake's existing URLs and rankings must be preserved; the final structure and 301 map must be decided during Phase 11 audit. A mixed approach (keep legacy default-language URLs, add prefixes only for new locales) is an option. **[Open]**
- Currently observed Flowers site is English-only; Arabic is new content to be produced.

## Content workflow [Proposed]

Translation status per entity/field, required-language rules before publishing, optional machine-assisted draft with human review (not decided). Arabic copy quality owner: **[Open]**.

## Typography [Open]

Arabic typeface pairing per brand to be chosen with the brand assets ([DESIGN-SYSTEM](DESIGN-SYSTEM.md)).

## Testing

RTL visual and functional tests, long-text and mixed-direction text (e.g., Arabic with Latin SKUs), number formatting — [TESTING](TESTING.md).
