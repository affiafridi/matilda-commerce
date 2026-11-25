# Notifications and Integrations

## Channels [Approved]

Email; WhatsApp; SMS; in-app; future push notifications.

## Events [Approved]

Registration; password reset; order confirmation; payment confirmation; failed payments; production updates; delivery updates; order cancellation; refund confirmation; abandoned carts; marketing campaigns. [Proposed] also: low-stock and new-order alerts to staff, delivery assignment to riders.

## Design [Proposed]

- Event → rule → channel(s) → template pipeline; domain modules publish events, the notifications module resolves recipients, consent/preferences, template (**brand + market + language** specific), and enqueues a BullMQ job per channel.
- Provider adapters per channel (interface like payments) with retries, backoff, dead-letter, delivery status webhooks, and idempotency keys to avoid duplicate sends.
- Templates editable in admin (Notification templates module) with variables, preview, versioning; RTL-safe Arabic templates.
- Transactional vs marketing separation; **marketing requires consent**; respect customer notification preferences; unsubscribe handling.
- Notification log per recipient/event for support and audit; no sensitive data beyond need.

## WhatsApp [Open]

WhatsApp Business API provider and template-approval process (Meta-approved templates for outbound business-initiated messages); per-brand numbers. The live Flowers site uses a phone number and WhatsApp click-to-chat links (observed in text-only fetch; requires verification) — inbound WhatsApp orders are handled manually via manual order entry ([ORDER-MANAGEMENT](ORDER-MANAGEMENT.md)), automation is future.

## Planned integrations [Approved list]

CCAvenue ([PAYMENTS](PAYMENTS.md)); WhatsApp Business API; Google Maps or approved mapping provider ([DELIVERY](DELIVERY.md)); email providers; SMS providers; Google Analytics, Merchant Center, Search Console ([SEO](SEO.md)); Meta advertising tools; future mobile apps; future external order management systems. Specific providers for email/SMS are **[Open]**.

## Security

Webhook signature verification; provider credentials stored like payment secrets ([SECURITY](SECURITY.md)); rate limits on OTP/SMS to prevent abuse and cost attacks.
