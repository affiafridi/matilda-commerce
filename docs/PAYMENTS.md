# Payments

## Per-brand, per-market merchant accounts [Approved]

Each brand may have its own **independent CCAvenue merchant account**. Matilda Flower, Matilda Cake and Cookies by Matilda can each use different Merchant IDs, access codes, working keys, merchant configurations, bank settlement accounts and enabled payment methods. Configurations are scoped to **brand and market**.

## Provider architecture [Approved + Proposed]

A reusable `PaymentProvider` interface so new providers can be added without rebuilding checkout:

```text
initiate(order, config) → redirect/session
verify(callbackPayload|query, config) → normalized result   (server-side, signature/encryption verified)
handleWebhook(event, config)
refund(payment, amount, config)        # uses ORIGINAL transaction's config
status(payment, config)                # for reconciliation
```

Providers/methods in scope: CCAvenue; cash on delivery; manual payments (bank transfer, card machine, recorded by staff); advance and partial payments; future providers.

## Capabilities [Approved]

Payment initiation; secure verification; callback handling; webhooks where supported; status reconciliation; **duplicate payment prevention; idempotency**; full and partial refunds where supported; failed-payment recovery; transaction history; financial reporting.

## Rules

- Payment success is determined only by server-side verification with the provider (never by the browser redirect alone or client claims).
- Payment attempts are recorded separately from the order; one order may have several attempts; only one captured payment per amount due unless explicitly partial.
- Callback/webhook processing is idempotent and transactional with order confirmation.
- Refunds and reconciliation use the **merchant configuration that processed the original transaction**, even if the config later changes (store config version/reference on the payment).
- Credentials encrypted at rest (envelope encryption; master key in a secret manager/environment, not in DB or Git); decrypted only server-side; never sent to frontend; never logged; staff UI shows masked values and requires `settings.manage_payments` plus step-up authentication, with audit entries ([SECURITY](SECURITY.md)).
- **No raw card data is stored**; hosted payment page keeps the platform out of PCI card-data scope.
- Per-brand callback/return URLs on the brand's own domain.

## Before production integration — verify [Open]

- CCAvenue account status per brand, domain whitelisting, callback/return URL requirements, supported currencies (AED) and methods (cards, wallets, Apple Pay?), refund API availability, webhook/status-API support, settlement schedule.
- Whether Cookies by Matilda and Matilda Cake accounts already exist and how the existing WooCommerce plugin is configured ([FEATURE-PARITY](FEATURE-PARITY.md)).

## Reporting

Transactions, payments, refunds and reconciliation feed [ADMIN-PANEL](ADMIN-PANEL.md) Finance modules and the Phase 9 reports ([ROADMAP](ROADMAP.md)).
