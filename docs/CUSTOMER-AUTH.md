# Customer Authentication and Accounts

## Registered Customer [Approved]

An explicit account type with **no administrative permissions**. Functionality:

- Registration; login/logout; email and phone verification; password reset.
- Profile management; multiple saved addresses.
- Order history; order tracking; reordering.
- Wishlist; product reviews.
- Loyalty points and rewards; gift cards.
- Notification preferences (channel and marketing consent).
- Personal data management; account deletion requests.

Accounts are **brand-specific by default**. Shared customer identity across brands may be supported by the architecture in future only if explicitly approved ([DECISIONS](DECISIONS.md) open item).

## Guest Customer [Approved]

Unauthenticated; can browse, search/filter, add to cart, apply coupons, choose delivery date/time, complete guest checkout, pay, **securely track orders**, and optionally create an account after checkout.

Guest order tracking [Proposed]: unguessable tracking token and/or order number + contact verification (OTP), rate-limited, minimal data shown.

## Cart behavior

Guest cart persisted by anonymous token; merged into the customer cart on login ([CART-AND-CHECKOUT](CART-AND-CHECKOUT.md)).

## Security [Approved + Proposed]

- Separate auth realm from staff; customers can never call staff APIs; cross-customer and cross-brand access impossible (ownership + brand checks on every record).
- Argon2id password hashing; HttpOnly secure cookies where appropriate; CSRF protection; rate limiting and brute-force protection; session revocation; verified email/phone before sensitive operations.
- Social login/passwordless: **[Open]** (not requested).
- Data subject features: export, correction, deletion request with retention-aware anonymization (orders/invoices retained as legally required).
- Marketing consent captured with timestamp/source; respected by [NOTIFICATIONS](NOTIFICATIONS.md).

See [SECURITY](SECURITY.md), [API](API.md) (`/api/v1/customer/`).

## Open

Phone verification provider and UAE SMS sender requirements; whether the same email may register on multiple brands (default yes, separate accounts); guest-to-account conversion rules; birthday/anniversary data consent flow.
