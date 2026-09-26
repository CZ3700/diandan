/** No public issuer: a UUID cannot confer authority to an order. */
export function orderAccessPaths() {
  const origin = {
    name: "Origin",
    in: "header",
    required: true,
    schema: { type: "string", format: "uri" },
  };
  const response = {
    description:
      "Minimal protected historical order or stable privacy-safe failure. Ordinary reads have no payment or notification side effects.",
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
        description:
          "Order-session-bound proof. Retain only in memory, never browser storage.",
      },
      "Retry-After": {
        schema: { type: "integer", minimum: 1 },
        description: "Present when the durable rate limit denies the request.",
      },
    },
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/OrderAccessResponse" },
      },
    },
  };
  const responses = Object.fromEntries(
    [200, 400, 401, 403, 409, 413, 415, 429, 503].map((status) => [
      status,
      response,
    ]),
  );
  const mutation = (
    operationId: string,
    request: string,
    description: string,
    security: Record<string, string[]>[],
  ) => ({
    operationId,
    description,
    security,
    parameters: [origin],
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
    "/api/v1/order-access/exchange": {
      post: mutation(
        "exchangeOrderAccess",
        "OrderAccessExchangeRequest",
        "Exchange a canonical 256-bit single-use link credential for a Secure HttpOnly SameSite=Strict host-only order cookie. No token in URL/query. Consumption and session rotation are atomic; replay never grants a new session. An existing cookie and the already-known publicOrderId can recover with a protected GET after a lost JSON response; the cookie alone cannot discover the order.",
        [],
      ),
    },
    "/api/v1/checkout/sessions/{checkoutSessionId}/order-access": {
      post: {
        ...mutation(
          "bootstrapOrderAccess",
          "OrderAccessBootstrapRequest",
          "Reauthenticate the original unexpired cart and independently verify the persisted paid order aggregate before atomically granting access. An expired quote does not erase an already paid order. Never trusts a browser payment flag.",
          [{ CartSession: [], CartCsrf: [] }],
        ),
        parameters: [
          origin,
          {
            name: "checkoutSessionId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
      },
    },
    "/api/v1/orders/{publicOrderId}": {
      get: {
        operationId: "readProtectedOrder",
        description:
          "Authorize the exact order scope before reading immutable purchase-time names, language provenance, media and amounts. No query/body; no private intent, contact address, internal IDs or credential material. Current catalog publication is irrelevant to historical access.",
        security: [{ OrderSession: [] }],
        parameters: [
          { ...origin, required: false },
          {
            name: "publicOrderId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses,
      },
    },
    "/api/v1/orders/{publicOrderId}/delivery-proofs/{proofId}/{rendition}": {
      get: {
        operationId: "readDeliveryProof",
        description:
          "Stream one private studio delivery photo of this order after authorizing the exact order session. Only proofs attached to delivered physical lines and not withdrawn are readable; unknown and foreign proofs are indistinguishable. Shares the READ rate-limit bucket. Bytes come from private storage, never from a public or signed URL.",
        security: [{ OrderSession: [] }],
        parameters: [
          { ...origin, required: false },
          {
            name: "publicOrderId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
          {
            name: "proofId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
          {
            name: "rendition",
            in: "path",
            required: true,
            schema: { type: "string", enum: ["thumbnail", "display"] },
          },
        ],
        responses: {
          ...responses,
          200: {
            description:
              "Metadata-free WebP rendition. Never cached, sniffed, framed or referred.",
            headers: {
              "Cache-Control": {
                schema: { type: "string", const: "private, no-store" },
              },
              "X-Content-Type-Options": {
                schema: { type: "string", const: "nosniff" },
              },
              "Cross-Origin-Resource-Policy": {
                schema: { type: "string", const: "same-origin" },
              },
              "Referrer-Policy": {
                schema: { type: "string", const: "no-referrer" },
              },
            },
            content: {
              "image/webp": { schema: { type: "string", format: "binary" } },
            },
          },
        },
      },
    },
    "/api/v1/order-access/locate": {
      post: mutation(
        "locateOrderAccess",
        "OrderAccessLocateRequest",
        "Resolve a typed public order number to its publicOrderId only when this browser's active order session belongs to that order. Read-only: no lock, credential, rotation or audit; shares the READ rate-limit bucket. A number alone never reveals or authorizes an order.",
        [{ OrderSession: [] }],
      ),
    },
    "/api/v1/order-access/revoke": {
      post: mutation(
        "revokeOrderAccess",
        "OrderAccessRevokeRequest",
        "Authenticate this order session and its independent CSRF proof, then revoke it and active links atomically. Unknown or cross-order credentials never revoke another order.",
        [{ OrderSession: [], OrderCsrf: [] }],
      ),
    },
  };
}
