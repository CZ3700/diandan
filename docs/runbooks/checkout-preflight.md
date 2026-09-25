# Checkout preflight runtime

P4-03 extends the existing PostgreSQL anonymous cart. It validates an expiring server observation first, then atomically creates an immutable checkout quote and pending-payment order after explicit policy consent. Payment-provider selection and hosted payment actions belong to P4-04.

## Request boundary

All three endpoints use the existing opaque cart Cookie and its versioned server-side verification. Mutations also require the established Origin, CSRF and idempotency checks. A checkout or preflight UUID alone never grants access. Public responses use private/no-store cache policy and cannot contain customer email, encrypted intent identifiers, private messages, full fan display names, storage keys or artist fulfillment details.

- `POST /api/v1/cart/validate`: expected cart version and presentation locale. Read the current artist, gift, variant, price, eligibility, inventory policy, media evidence, approved policies and fulfillment availability from PostgreSQL. Persist a short-lived observation without creating an order or holding stock.
- `POST /api/v1/checkout/sessions`: reference the observation, expected version, contact email and explicit acceptance of the exact policy revisions shown. Browser amount, currency, provider and order snapshots are not accepted. Revalidate after external contact encryption, then commit all business changes together.
- `GET /api/v1/checkout/sessions/:id/status`: query the same cart's persisted history. It cannot create or confirm payment and cannot change the order's presentation language.

## Commerce and privacy invariants

A TRACKED gift uses real active inventory balances, reservations and an append-only ledger in the order transaction. The full cart is considered when the same variant is sent to multiple artists. PROCURE_ON_DEMAND and PREORDER never use invented balances. A single tracked cart line cannot split its reservation across locations under the existing schema.

Orders freeze the actual publication and translation provenance separately for artist, gift and both image descriptions. Daily original-language content uses its true source language. Critical policies require an effective, approved translation and retain its exact revision. Later content edits or interface-language changes do not rewrite history.

Each new order receives its own encrypted customer contact. Email lookup uses the existing keyed HMAC purpose; original email and private support text never enter a receipt or event. KMS calls run outside the database transaction. Existing encrypted support intents are locked without decryption.

A pending order also needs an initial pending fulfillment with a genuine configured artist fulfillment profile. Missing configuration prevents checkout. Local fixtures may establish explicitly TEST encrypted profiles using the existing KMS adapter; this is not production delivery configuration or approval.

Each initial fulfillment writes its exact PENDING event through the existing Outbox port before the final transaction commits. The separate checkout-created event remains durable in `checkout_outbox_events`; its consumer is a later-stage responsibility. Neither event establishes payment success or instructs the studio to deliver an unpaid order.

## Recovery boundary

Retry a failed or unknown response with the same request body and idempotency key. Only an explicitly aborted database transaction is automatically retried. A committed checkout locks the cart and its intents; a second key cannot create another order. Expired or changed observations must be displayed again for explicit confirmation. Future expiry cleanup and payment/reservation finalization belong to P4-05/P4-06.

After a price change, the existing cart quantity-edit command can explicitly accept the current price ID while keeping the same item and quantity. Read the current cart first, retain both expected versions, and then request a new observation. A stale observation or an unconfirmed old price never creates a replacement quote silently.

## Validation evidence

Implementation and exact acceptance commands/results are recorded in `docs/progress/phase-4-commerce.md` and `output/checks/p4-03-checkout-preflight/`. Local tests do not establish PSP, production policy, real fulfillment, AWS/IAM, staging or release readiness.
