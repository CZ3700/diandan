import { SUPPORTED_LOCALES } from "./locale.js";

/** These operations require the owning protected cart; locators and return query values confer no authority. */
export function paymentRuntimePaths() {
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
  const locator = (name: string) => ({
    name,
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
  });
  const result = {
    description:
      "Private persisted payment state or stable failure; UNKNOWN never permits a second charge.",
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
        description: "Session-bound value; memory only.",
      },
    },
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/PaymentRuntimeResponse" },
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
  const read = (
    operationId: string,
    description: string,
    parameters: unknown[],
  ) => ({
    operationId,
    description,
    security: [{ CartSession: [] }],
    parameters: [{ ...origin, required: false }, ...parameters],
    responses,
  });
  const write = (
    operationId: string,
    request: string,
    description: string,
    parameters: unknown[],
  ) => ({
    operationId,
    description,
    security: [{ CartSession: [], CartCsrf: [] }],
    parameters: [origin, idempotency, ...parameters],
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
  const session = locator("checkoutSessionId");
  const attempt = locator("attemptId");
  return {
    "/api/v1/checkout/current/status": {
      get: read(
        "readCurrentCheckout",
        "Recover the existing checkout and active attempt from the owning HttpOnly cart after reload or a lost response. No query or body; no order creation or provider calls.",
        [],
      ),
    },
    "/api/v1/checkout/sessions/{checkoutSessionId}/capabilities": {
      get: read(
        "readCheckoutPaymentCapabilities",
        "Use the persisted order amount and published payment rules. Interface locale never selects country, market, currency or account. When every selectable country sees the same payment methods, a missing country resolves to the first selectable country and countrySelectionRequired is false; otherwise a missing country returns the selectable countries without methods and countrySelectionRequired is true. The provider capability call is read-only and outside SQL.",
        [
          session,
          {
            name: "presentationLocale",
            in: "query",
            required: true,
            schema: { type: "string", enum: [...SUPPORTED_LOCALES] },
          },
          {
            name: "country",
            in: "query",
            required: false,
            schema: { type: "string", pattern: "^[A-Z]{2}$" },
          },
          {
            name: "supportedActionTypes",
            in: "query",
            required: true,
            style: "form",
            explode: false,
            schema: {
              type: "array",
              minItems: 1,
              maxItems: 4,
              uniqueItems: true,
              items: {
                type: "string",
                enum: [
                  "REDIRECT",
                  "PROVIDER_HOSTED_IFRAME",
                  "PROVIDER_COMPONENT",
                  "QR_CODE",
                ],
              },
            },
          },
        ],
      ),
    },
    "/api/v1/checkout/sessions/{checkoutSessionId}/attempts": {
      post: write(
        "createCheckoutPaymentAttempt",
        "PaymentRuntimeCreateRequest",
        "Permanently bind the original request key to one attempt. Validate exact current configuration, quote and reservations, freeze provider/account/environment/locale/return URLs before calling the adapter, then persist the fenced result. Browser financial or provider fields are rejected. Active or successful attempts cannot be replaced.",
        [session],
      ),
    },
    "/api/v1/checkout/sessions/{checkoutSessionId}/attempts/{attemptId}": {
      get: read(
        "readCheckoutPaymentAttempt",
        "Read only the authorized persisted attempt and a currently valid decrypted action. Return query values cannot confirm payment and GET never starts reconciliation.",
        [session, attempt],
      ),
    },
    "/api/v1/checkout/sessions/{checkoutSessionId}/attempts/{attemptId}/recover":
      {
        post: write(
          "recoverCheckoutPaymentAttempt",
          "PaymentRuntimeRecoverRequest",
          "Recover only the same attempt under a durable lease. A crashed CREATED operation reuses the frozen provider command and key; UNKNOWN uses authenticated reconciliation only. Trusted success evidence remains pending until atomic order/payment/inventory finalization is implemented. No rerouting or new charge.",
          [session, attempt],
        ),
      },
  };
}
