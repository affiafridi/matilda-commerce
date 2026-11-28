# Order and Production Management

## Order sources [Approved]

Website; WhatsApp; telephone; walk-in; manually created; future external integrations. Source is recorded on every order.

## Capabilities [Approved]

Order creation and editing; status management; payment, production and fulfillment statuses; branch assignment; production staff assignment; order notes; customer instructions; product customization details; activity timeline; source tracking; invoices and receipts; cancellation; refunds; partial and advance payments; delivery assignments; notifications; order tracking; filtering; bulk operations; export; reporting.

## Separate status dimensions, controlled transitions [Approved + Proposed]

Never allow arbitrary status changes. Each dimension is a state machine with permitted transitions, required permissions, and audit/timeline entries.

| Dimension | Proposed states |
|---|---|
| Order | draft → pending_payment → confirmed → in_progress → completed; cancelled; (on_hold) |
| Payment | unpaid → pending → partially_paid → paid → partially_refunded → refunded; failed; (cod_pending) |
| Production | queued → assigned → in_preparation → ready → (quality_check); rework |
| Fulfillment | unassigned → assigned → out_for_delivery → delivered; failed_delivery; returned; (pickup_ready → picked_up) |

State names and transitions are **[Proposed]** and must be finalized in design review. [Phase 5] The order, payment, fulfillment, payment-attempt and cart machines are implemented (shared contract `commerce.ts` and database triggers, kept identical by a test); the production dimension arrives in Phase 6.

## Snapshots [Approved]

Order items store product name, variation, options, add-ons, prices, discounts, taxes, delivery fee, applied promotions, delivery address, and branch at order time. Later catalog/price changes never alter historical orders.

## Manual orders [Approved]

Order Coordinator creates orders for WhatsApp/phone/walk-in using the same backend pricing, availability and delivery validation as the website (with permissioned overrides, e.g., custom price/discount, audited). Payment may be recorded as COD, manual, advance or partial.

## Production [Approved]

Production staff get a **focused interface**: only assigned orders and preparation requirements (item, options, message text, reference images, deadline/slot, notes), status updates, and no unrelated customer/financial data. Production capacity and prep times feed [DELIVERY](DELIVERY.md) availability.

## Branch handling [Approved]

Auto-assignment and manual assignment/transfer between eligible branches; every order retains brand, market and fulfillment branch.

## Documents

Invoices/receipts per market requirements (numbering, VAT/tax invoice rules for UAE — **[Open]** to confirm), PDF generation approach **[Open]**.

## Refunds and cancellation

Cancellation rules by status and production stage; refunds through [PAYMENTS](PAYMENTS.md) on the original merchant config; `refunds.create` vs `refunds.approve` separation ([ROLES-AND-PERMISSIONS](ROLES-AND-PERMISSIONS.md)).

## Open

Edit rules after payment/production start; order-number format per market; cancellation fees; partial fulfillment; returns for perishable goods.
