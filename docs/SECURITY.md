# Security

Production-grade practices throughout. Never commit secrets or production credentials. Never log passwords, payment secrets or unnecessary personal information.

## Authentication [Approved]

- Separate staff and customer authentication and authorization policies.
- Password hashing: **Argon2id** (or another approved secure algorithm).
- **Staff two-factor authentication** (TOTP; recovery codes) — mandatory.
- Secure session management; HttpOnly, Secure, SameSite cookies where appropriate; session revocation; device/session list.
- Brute-force protection and rate limiting (Redis); account lockout/step-up policies.

## Authorization [Approved]

Permission-based guards on every protected API; brand/market/branch data-scope enforcement; ownership checks for customer data. **Store-level data isolation** at application and database level ([DATABASE](DATABASE.md)). Additional authorization and auditing for sensitive financial/administrative actions: payment settings, refund approval, role/permission changes, data exports, impersonation (if ever added), user management.

## Web/application security [Approved]

CSRF protection where applicable; XSS prevention (output encoding, sanitized rich text, CSP); SQL-injection prevention (Prisma parameterization, no unsafe raw queries); strict input validation (Zod); controlled CORS per brand domain; secure headers; SSRF-safe fetchers.

## Payments and secrets [Approved]

Payment credentials encrypted (envelope encryption, keys outside DB); never exposed to frontend; no raw card data stored; webhook signature verification; idempotent callbacks ([PAYMENTS](PAYMENTS.md)). Secrets via environment/secret manager; rotation procedure documented in [DEPLOYMENT](DEPLOYMENT.md).

## Files [Approved]

Secure uploads: type allow-list by content sniffing, size limits, randomized storage keys, private buckets for customer reference images and proofs, image re-encoding, optional malware scanning **[Open]**; signed URLs for access.

## Data protection

Sensitive data minimization; PII access logging for support roles; data export controls and audit; retention and deletion policies ([DATABASE](DATABASE.md)); consent records. Privacy/legal basis per market (UAE PDPL and others) **[Open — legal review]**.

## Audit [Approved]

Append-only audit log: actor, scope, action, target, before/after (redacted), IP, timestamp. Permission-change tracking. Activity logs visible per permission.

## Operations [Approved]

Automated backups; dependency vulnerability monitoring (e.g., GitHub Dependabot/audit in CI); secure production configuration; private database access; Cloudflare WAF; Sentry and structured logging with redaction.

## Threat priorities

Cross-brand leakage; broken access control (IDOR); payment tampering and callback forgery; coupon/gift-card abuse; account takeover; upload abuse; OTP/SMS cost abuse; admin privilege escalation. Each has dedicated tests in [TESTING](TESTING.md).
