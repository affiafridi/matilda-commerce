# Deployment and Infrastructure

**Phase 0: nothing is to be configured.** This document is a plan.

## Components [Approved]

GitHub (single repo) · Docker · Nginx reverse proxy · GitHub Actions CI/CD · Cloudflare (DNS, CDN, WAF) · PostgreSQL · Redis · Cloudflare R2.

## Environments [Approved]

Development, Staging, Production — each with its own database, Redis, R2 bucket/prefix, secrets, and **separate payment credentials** (staging uses test merchant settings).

## Topology [Proposed]

Initially shared infrastructure hosts everything: containers for `storefront`, `admin`, `api`, `worker` behind Nginx; PostgreSQL (private network only); Redis; R2 for media. Applications deploy **independently** (each its own image/pipeline) while sharing the backend. Separation later if traffic, availability or regulatory needs require it ([ARCHITECTURE](ARCHITECTURE.md)). Hosting provider/region (UAE data residency preference?) is **[Open]**.

## Requirements [Approved]

Secure HTTPS (TLS via Cloudflare + origin certs); private DB access; environment variables; secret management (no secrets in Git); automated deployment; **rollback procedures**; application health checks; error monitoring (Sentry); structured logging (Pino); **automated off-site database backups** and tested **restoration procedures**; resource monitoring; database migration procedures; controlled production releases.

## CI/CD [Proposed]

PR: lint, type-check, tests, build, dependency audit. Merge to main → staging deploy → smoke tests → manual approval → production deploy (blue/green or rolling) → health-check gate → auto-rollback on failure. Migrations: backward-compatible (expand/contract), run as a gated step, backup before destructive changes.

## Domains

Per-brand domains map to the trusted domain→brand configuration ([MULTI-STORE](MULTI-STORE.md)); DNS and TLS for `matildaflower.com`, `matildacake.com`, `cookiesbymatilda.com` (and `www` variants) managed via Cloudflare. Cutover for existing live sites follows the SEO migration plan ([SEO](SEO.md)); existing sites are **not modified** in Phase 0.

## Backups and DR

Daily full + frequent WAL/PITR if supported; off-site encrypted copies; retention policy **[Open]**; RPO/RTO targets **[Open]**; restore drills ([TESTING](TESTING.md)); R2 object versioning.

## Open

Hosting vendor; sizing; WAF rules; staging data policy (anonymized copies only); maintenance-window policy during peak seasons.
