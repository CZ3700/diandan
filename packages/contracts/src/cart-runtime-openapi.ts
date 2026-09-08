export function cartRuntimePaths() {
  const response = (description: string) => ({
    description,
    headers: {
      "Cache-Control": {
        schema: { type: "string", const: "private, no-store" },
      },
      "X-CSRF-Token": {
        schema: { type: "string" },
        description: "Private session-bound CSRF token; keep only in memory.",
      },
    },
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/CartRuntimeCurrentResponse" },
      },
    },
  });
  const origin = {
    name: "Origin",
    in: "header",
    required: true,
    schema: { type: "string", format: "uri" },
    description:
      "Must exactly match the configured storefront origin; no credentialed public CORS.",
  };
  const requestBody = (name: string) => ({
    required: true,
    content: {
      "application/json": { schema: { $ref: `#/components/schemas/${name}` } },
    },
  });
  const responses = {
    200: response("Current private cart projection."),
    400: response("Invalid body, headers or query."),
    401: response("Cart credential missing or invalid."),
    403: response("Origin or CSRF rejected."),
    404: response("Cart session not found."),
    409: response(
      "Expired/locked cart, current commerce facts or idempotency conflict; inspect the stable code. Expired cart cookies are cleared.",
    ),
    413: response("Request exceeds 8192 bytes."),
    503: response(
      "Temporarily unavailable or transaction outcome unknown; retain the original idempotency key.",
    ),
  };
  return {
    "/api/v1/carts": {
      post: {
        operationId: "initializeAnonymousCart",
        summary: "Initialize or reuse an anonymous cart",
        description:
          "Creates only an empty cart before adding an item. A newly issued 256-bit token is delivered solely in a Secure HttpOnly SameSite=Lax host-only cookie. No token, cart ID or private content is returned in JSON. An existing valid session retains its market and currency.",
        security: [],
        parameters: [origin],
        requestBody: requestBody("CartRuntimeInitializeRequest"),
        responses,
      },
    },
    "/api/v1/cart": {
      get: {
        operationId: "readAnonymousCart",
        summary: "Read the current anonymous cart",
        description:
          "Only a single presentationLocale query is accepted. Switching the presentation language never changes price, market or currency. Item content is rebuilt from current publication proof; no stale private mutation response is cached.",
        security: [{ CartSession: [] }],
        parameters: [
          { ...origin, required: false },
          {
            name: "presentationLocale",
            in: "query",
            required: true,
            schema: { $ref: "#/components/schemas/SupportedLocale" },
          },
        ],
        responses,
      },
    },
    "/api/v1/cart/items": {
      post: {
        operationId: "addAnonymousCartItem",
        summary: "Add an independently personalized gift line",
        description:
          "Authenticates the cookie, exact Origin and session-bound CSRF token. The Idempotency-Key plus exact canonical command identifies a retry; a new key creates an independent line. Current publication, recipient, price and stock are validated with the atomic PostgreSQL cart write. Private fields are envelope-encrypted; the intent, item, receipt and outbox event commit together. Adding never reserves inventory.",
        security: [{ CartSession: [], CartCsrf: [] }],
        parameters: [
          origin,
          {
            name: "Idempotency-Key",
            in: "header",
            required: true,
            schema: {
              type: "string",
              minLength: 16,
              maxLength: 256,
              pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
            },
          },
        ],
        requestBody: requestBody("CartRuntimeAddRequest"),
        responses,
      },
    },
  };
}
