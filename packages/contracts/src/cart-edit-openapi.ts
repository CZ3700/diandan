export function cartEditPaths() {
  const origin = {
    name: "Origin",
    in: "header",
    required: true,
    schema: { type: "string", format: "uri" },
    description:
      "Exact configured storefront origin, checked before reading private JSON.",
  };
  const item = {
    name: "itemId",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
    description:
      "Item identity is not authorization; the current protected cart session must own it.",
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
  function operation(
    operationId: string,
    request: string,
    response: string,
    description: string,
    mutation: boolean,
  ) {
    const result = {
      description: "Private scoped result or stable failure code.",
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
          description: "Keep this session-bound token in memory only.",
        },
      },
      content: {
        "application/json": {
          schema: { $ref: `#/components/schemas/${response}` },
        },
      },
    };
    return {
      operationId,
      description,
      security: [{ CartSession: [], CartCsrf: [] }],
      parameters: mutation ? [origin, item, idempotency] : [origin, item],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: `#/components/schemas/${request}` },
          },
        },
      },
      responses: {
        200: result,
        400: result,
        401: result,
        403: result,
        404: result,
        409: result,
        413: result,
        503: result,
      },
    };
  }
  return {
    "/api/v1/cart/items/{itemId}": {
      patch: operation(
        "updateAnonymousCartItem",
        "CartEditUpdateRequest",
        "CartEditResponse",
        "Update quantity with observed current price or replace the complete private personalization. Both cart and item expected versions are required. A stale version cannot overwrite another edit. The exact original idempotency key and body recover an uncertain result; a completed replay is checked before version conflicts. Recipient and variant are immutable.",
        true,
      ),
      delete: operation(
        "removeAnonymousCartItem",
        "CartEditRemoveRequest",
        "CartEditResponse",
        "Cancel the owned active intent and hide its cart line. Preserve item, intent and mutation history. Removal and its durable event/receipt commit atomically; replay succeeds even while the item remains absent.",
        true,
      ),
    },
    "/api/v1/cart/items/{itemId}/editor": {
      post: operation(
        "readPrivateCartItemEditor",
        "CartEditorReadRequest",
        "CartEditorResponse",
        "Sensitive editor read, allowed only after explicit fan interaction. Requires Cookie, exact Origin, CSRF and current cart/item versions. Persist an authorized access audit before KMS decryption, then recheck ownership, privacy state, expiry and all versions in a new transaction. Decrypted fields must never enter ordinary cart JSON, SSR, logs, analytics or browser persistence. Clear editor memory on close and ignore late responses.",
        false,
      ),
    },
  };
}
