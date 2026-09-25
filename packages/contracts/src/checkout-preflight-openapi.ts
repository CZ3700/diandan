/** Checkout is always scoped by the protected cart, never by a UUID alone. */
export function checkoutPreflightPaths() {
  const origin = {
    name: "Origin",
    in: "header",
    required: true,
    schema: { type: "string", format: "uri" },
  };
  const idempotency = {
    name: "Idempotency-Key",
    in: "header",
    required: true,
    schema: {
      type: "string",
      minLength: 16,
      maxLength: 256,
      pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
    },
  };
  const result = {
    description:
      "Private checkout result or stable failure. Retain the exact body and key on unknown outcome.",
    headers: {
      "Cache-Control": {
        schema: { type: "string", const: "private, no-store" },
      },
      "Referrer-Policy": { schema: { type: "string", const: "no-referrer" } },
      "X-Robots-Tag": {
        schema: { type: "string", const: "noindex, nofollow" },
      },
      "X-CSRF-Token": {
        schema: { type: "string" },
        description: "Session-bound value; keep in memory only.",
      },
    },
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/CheckoutPreflightResponse" },
      },
    },
  };
  const responses = {
    200: result,
    400: result,
    401: result,
    403: result,
    404: result,
    409: result,
    413: result,
    503: result,
  };
  const mutation = (
    operationId: string,
    request: string,
    description: string,
  ) => ({
    operationId,
    description,
    security: [{ CartSession: [], CartCsrf: [] }],
    parameters: [origin, idempotency],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: `#/components/schemas/${request}` },
        },
      },
    },
    responses,
  });
  return {
    "/api/v1/cart/validate": {
      post: mutation(
        "validateCheckoutPreflight",
        "CheckoutPreflightValidateRequest",
        "Validate the exact active cart version and current canonical artist, gift, eligibility, price, stock, media, fulfillment and approved policy facts. Persist an expiring observation and server-calculated quote without reserving inventory or creating an order. Same key/body recovers the same observation. No browser amount, currency or provider is accepted.",
      ),
    },
    "/api/v1/checkout/sessions": {
      post: mutation(
        "createCheckoutSession",
        "CheckoutPreflightCreateRequest",
        "Reference the observation and explicitly accept its exact policy revisions. Contact encryption occurs outside SQL transactions. Reauthenticate and compare current canonical facts, then atomically persist quote, amount, pending order, per-object translation/media provenance, initial fulfillment, intent/cart locks, tracked reservations and ledger, receipt and durable event. Procure-on-demand/preorder never use fake stock. UNKNOWN must retain the original key/body; no payment is created or confirmed here.",
      ),
    },
    "/api/v1/checkout/sessions/{checkoutSessionId}/status": {
      get: {
        operationId: "readCheckoutSessionStatus",
        description:
          "Read the current cart's persisted checkout history. No query or body is accepted; requested UI locale cannot change historical snapshots. An expired quote is identified without rewriting the order. Cookie ownership is mandatory. This endpoint cannot confirm payment.",
        security: [{ CartSession: [] }],
        parameters: [
          { ...origin, required: false },
          {
            name: "checkoutSessionId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses,
      },
    },
  };
}
