# Project Overview

## Vision [Approved]

Matilda Commerce is a premium, fully custom, scalable commerce platform — not just a flower shop. It is a centralized engine supporting multiple **brands, countries, branches, currencies, languages, payment gateways and business operations**. Core functionality is built once and reused across websites with independent branding, UI/UX, products, settings and payment accounts.

## Brands [Approved]

| Brand | Domain | Role |
|---|---|---|
| Matilda Flower | http://matildaflower.com | First storefront, first production launch |
| Matilda Cake | https://matildacake.com | Second; drives engine complexity |
| Cookies by Matilda | https://cookiesbymatilda.com | Third |

> Domain note: the owner corrected the Flowers domain to `matildaflower.com` (singular) and Cookies to `cookiesbymatilda.com` (the master prompt originally said `matildaflowers.com` / `cookiesbymatildacake.com`). `matildaflowers.com` is a different, unrelated Spanish-language floristry site and must not be used as a branding reference. See [DECISIONS.md](DECISIONS.md) D-002.

Matilda Cake has considerably more complex products, variations, customization, add-ons, delivery restrictions and promotions. The commerce engine must **not** be designed only around flowers ([FEATURE-PARITY.md](FEATURE-PARITY.md)).

## Observed state of the existing Flowers site [Observed from a text-only fetch, Phase 0]

Public homepage text indicates: brand name "Matilda Flower" (also "Matilda Flower Dubai"); WordPress-style paths (`/wp-content/`, `/product/`); English only; AED pricing; "Delivered Anywhere in Dubai"; phone and WhatsApp ordering; menu of Occasions, Seasons, Emotions, Zodiac Blooms, Signature, Our Story; footer entity reported as Matilda Cakes and Sweets L.L.C. (unconfirmed summary). Colors, fonts, logo appearance, checkout and payment methods were **not observable**. Treat everything above as **requires verification**; a proper brand review needs assets from the owner ([DESIGN-SYSTEM.md](DESIGN-SYSTEM.md)).

## Objectives

1. Launch Matilda Flower in the UAE on the new platform.
2. Support Matilda Cake and Cookies by Matilda without re-architecture.
3. Make international expansion primarily a configuration exercise.
4. Provide a centralized, permission-aware admin for all brands, markets and branches.
5. Deliver premium storefronts that do not look like generic templates.
6. Keep payment accounts, data and content independent per brand.

## Scope boundaries

- **In scope (long-term):** everything in [REQUIREMENTS.md](REQUIREMENTS.md).
- **Initially active:** Matilda Flower, UAE market only, English + Arabic. No unnecessary country-specific work for non-operating markets, but foundations support expansion.
- **Out of scope for now:** microservices, third-party commerce frameworks as backend, regional databases (planned-for, not built), mobile apps (future).

## Current phase

Phase 0 — documentation only. See [ROADMAP.md](ROADMAP.md) and [PROGRESS.md](PROGRESS.md).
