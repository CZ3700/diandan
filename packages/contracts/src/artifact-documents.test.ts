import { readFile } from "node:fs/promises";

import { expect, test } from "vitest";
import { z } from "zod";

import { paymentWebhookEndpointIdSchema } from "./identifiers.js";
import * as artifacts from "./artifact-documents.js";
import * as registry from "./artifact-registry.js";

type JsonObject = Record<string, unknown>;

/** Payment operations expose account identities only to authorized configuration staff. */
function withoutPaymentConfiguration(document: JsonObject): JsonObject {
  const components = document["components"] as JsonObject;
  const configurationSchemas = new Set([
    "AdminPaymentConfigurationCommand",
    "AdminPaymentConfigurationRequest",
    "AdminPaymentConfigurationResponse",
    "AdminPaymentConfigurationFailure",
  ]);
  return {
    ...document,
    paths: Object.fromEntries(
      Object.entries(document["paths"] as JsonObject).filter(
        ([path]) => !path.startsWith("/api/v1/admin/payment-configuration/"),
      ),
    ),
    components: {
      ...components,
      schemas: Object.fromEntries(
        Object.entries(components["schemas"] as JsonObject).filter(
          ([name]) => !configurationSchemas.has(name),
        ),
      ),
    },
  };
}

function isStrictVersionedRoot(schema: JsonObject): boolean {
  const alternatives = (schema["anyOf"] ?? schema["oneOf"]) as
    unknown[] | undefined;
  if (alternatives !== undefined) {
    return (
      alternatives.length > 0 &&
      alternatives.every(
        (alternative) =>
          alternative !== null &&
          typeof alternative === "object" &&
          isStrictVersionedRoot(alternative as JsonObject),
      )
    );
  }

  const properties = schema["properties"] as JsonObject | undefined;
  const schemaVersion = properties?.["schemaVersion"] as JsonObject | undefined;
  const required = schema["required"] as unknown[] | undefined;
  return (
    schema["additionalProperties"] === false &&
    [1, 2, 3].includes(Number(schemaVersion?.["const"])) &&
    required?.includes("schemaVersion") === true
  );
}

test("renders deterministic JSON Schema and OpenAPI documents from one registry", async () => {
  expect(artifacts, "artifact renderer module must exist").toBeDefined();
  expect(artifacts?.createContractArtifactDocuments).toBeTypeOf("function");
  expect(artifacts?.renderContractArtifactDocuments).toBeTypeOf("function");

  const documents = artifacts?.createContractArtifactDocuments() as Readonly<{
    jsonSchema: JsonObject;
    openapi: JsonObject;
  }>;
  const jsonDefinitions = documents.jsonSchema["$defs"] as JsonObject;
  const openapiComponents = (documents.openapi["components"] as JsonObject)[
    "schemas"
  ] as JsonObject;
  const requiredContracts = [
    "SupportedLocale",
    "LocaleContext",
    "Idol",
    "Gift",
    "GiftOffer",
    "PriceBook",
    "InventoryReservation",
    "Cart",
    "PublicCartView",
    "CartGiftContext",
    "SupportIntent",
    "CheckoutQuote",
    "OrderAmountSnapshot",
    "CheckoutSession",
    "PaymentCapability",
    "PaymentAction",
    "PaymentAttempt",
    "ProviderEvent",
    "Order",
    "PublicOrderView",
    "Refund",
    "Dispute",
    "GiftFulfillment",
    "NotificationCommand",
    "PublicErrorEnvelope",
    "EventEnvelope",
    "PublishedIdolView",
    "PublishedGiftView",
    "IdolBase",
    "IdolRevision",
    "IdolRevisionTranslation",
    "IdolRevisionMedia",
    "GiftBase",
    "GiftRevision",
    "GiftRevisionTranslation",
    "GiftVariantDefinition",
    "GiftVariantIdolEligibility",
    "GiftRevisionMedia",
    "HomepageRevision",
    "HomepageRevisionTranslation",
    "HomepageSlot",
    "PublishedHomepageView",
    "PolicyRevision",
    "PolicyRevisionTranslation",
    "PublishedPolicyView",
    "MediaAsset",
    "MediaVariant",
    "MediaMetadataRevision",
    "MediaMetadataRevisionTranslation",
    "PublishedMediaView",
    "PriceBookRevision",
    "Price",
    "InventoryLocation",
    "InventoryItem",
    "InventoryBalance",
    "InventoryLedgerEntry",
    "GiftPublicationCandidate",
    "IdolPublicationCandidate",
    "HomepagePublicationCandidate",
    "PolicyPublicationCandidate",
    "ContentPublicationCandidate",
    "TranslationApprovalEvidence",
    "TranslationPublicationManifestEntry",
    "ContentPublication",
    "PublicRevisionSelection",
    "PublicMediaProjectionSource",
    "IdolPublicProjectionSource",
    "GiftPublicProjectionSource",
    "HomepagePublicProjectionSource",
    "PolicyPublicProjectionSource",
    "PublicationValidationReport",
    "TranslationImportPackage",
    "TranslationImportValidationReport",
  ];

  expect(Object.keys(jsonDefinitions).sort()).toEqual(
    expect.arrayContaining(requiredContracts),
  );
  expect(documents.openapi["openapi"]).toBe("3.1.0");
  expect(documents.openapi["x-fan-support-document-kind"]).toBe(
    "implemented-paths-and-schema-components",
  );
  expect(
    (documents.openapi["paths"] as JsonObject)[
      "/api/v1/webhooks/payments/{endpointId}"
    ],
  ).toBeDefined();
  expect(registry).toBeDefined();
  expect(
    new Set(registry?.contractArtifactRegistry.map(({ name }) => name)).size,
  ).toBe(registry?.contractArtifactRegistry.length);
  for (const registration of registry?.contractArtifactRegistry ?? []) {
    const component = openapiComponents[registration.name] as
      JsonObject | undefined;
    if (registration.audience === "internal") {
      expect(
        component,
        `${registration.name} must remain internal`,
      ).toBeUndefined();
      continue;
    }
    expect(component?.["x-fan-support-audience"]).toBe(registration.audience);
    const componentSchema = Object.fromEntries(
      Object.entries(component ?? {}).filter(
        ([key]) => key !== "x-fan-support-audience",
      ),
    );
    expect(componentSchema).toEqual(jsonDefinitions[registration.name]);
  }

  expect(
    JSON.stringify(withoutPaymentConfiguration(documents.openapi)),
  ).not.toContain("providerAccountId");
  const renderedOpenapi = JSON.stringify(documents.openapi);
  for (const forbiddenField of [
    "fanMessageCiphertext",
    "displayNameCiphertext",
    "encryptedDataKey",
    "encryptionKeyVersion",
    "objectKey",
    "supportIntentId",
    "credentialRef",
    "merchantAccount",
    "providerIdempotencyKey",
    "externalReference",
    "customerContactId",
    "cartAccessToken",
    "orderAccessToken",
    "rawBody",
  ]) {
    expect(renderedOpenapi).not.toContain(forbiddenField);
  }

  for (const publicViewName of [
    "PublishedIdolView",
    "PublishedGiftView",
    "PublishedHomepageView",
    "PublishedPolicyView",
    "PublishedMediaView",
  ]) {
    const publicView = JSON.stringify(openapiComponents[publicViewName]);
    for (const internalField of [
      "draftRevisionId",
      "publishedRevisionId",
      "objectKey",
      "checksumSha256",
      "sourceHash",
      "translatedFromSourceHash",
      "editorId",
      "reviewerId",
      "importBatchId",
      "processingErrorCode",
      "rightsReference",
      "onHand",
      "reserved",
    ]) {
      expect(publicView).not.toContain(`"${internalField}"`);
    }
  }

  for (const publicCatalogName of ["PublishedIdolView", "PublishedGiftView"]) {
    const schema = openapiComponents[publicCatalogName] as JsonObject;
    const status = (schema["properties"] as JsonObject)["status"] as JsonObject;
    expect(status["enum"]).toEqual(["active", "paused"]);
  }

  expect(openapiComponents["Idol"]).toBeUndefined();
  expect(openapiComponents["Gift"]).toBeUndefined();
  expect(openapiComponents["PriceBook"]).toBeUndefined();
  expect(jsonDefinitions["Idol"]).toBeDefined();
  expect(jsonDefinitions["Gift"]).toBeDefined();
  expect(jsonDefinitions["PriceBook"]).toBeDefined();
  expect(openapiComponents["PriceBookRevision"]).toBeDefined();

  const publicError = jsonDefinitions["PublicErrorEnvelope"] as JsonObject;
  expect(publicError["additionalProperties"]).toBe(false);
  expect(publicError["required"]).toEqual(
    expect.arrayContaining(["schemaVersion", "code", "requestId"]),
  );
  expect(
    ((publicError["properties"] as JsonObject)["schemaVersion"] as JsonObject)[
      "const"
    ],
  ).toBe(1);

  const amount = jsonDefinitions["OrderAmountSnapshot"] as JsonObject;
  expect(amount["x-runtime-invariants"]).toEqual([
    "totalAmountMinor = subtotalMinor + taxAmountMinor + shippingAmountMinor + feeAmountMinor - discountAmountMinor",
  ]);

  const paymentAction = jsonDefinitions["PaymentAction"] as JsonObject;
  const paymentActionVariants = paymentAction["oneOf"] as JsonObject[];
  for (const variant of paymentActionVariants.slice(0, 2)) {
    const urlSchema = (variant["properties"] as JsonObject)[
      "url"
    ] as JsonObject;
    expect(urlSchema["format"]).toBe("uri");
    expect(urlSchema["pattern"]).toBe("^https:\\/\\/(?![^/?#]*@)");
  }

  const firstRender = artifacts?.renderContractArtifactDocuments();
  const secondRender = artifacts?.renderContractArtifactDocuments();
  expect(firstRender).toEqual(secondRender);
  expect(firstRender?.jsonSchema.endsWith("\n")).toBe(true);
  expect(firstRender?.openapi.endsWith("\n")).toBe(true);
});

test("documents the exact raw payment webhook HTTP boundary", async () => {
  const { createContractArtifactDocuments } =
    await import("./artifact-documents.js");
  const { openapi } = createContractArtifactDocuments();
  const components = openapi["components"] as JsonObject;
  const schemas = components["schemas"] as JsonObject;
  const securitySchemes = components["securitySchemes"] as JsonObject;
  const paths = openapi["paths"] as JsonObject;
  const path = paths["/api/v1/webhooks/payments/{endpointId}"] as JsonObject;
  const operation = path["post"] as JsonObject;

  expect(
    Object.keys(paths)
      .filter(
        (path) =>
          !path.startsWith("/api/v1/admin/content/") &&
          path !== "/api/v1/content-preview/read",
      )
      .sort(),
  ).toEqual([
    "/api/storefront/rum",
    "/api/v1/admin-preview-media/read",
    "/api/v1/admin/catalog/history/read",
    "/api/v1/admin/catalog/idols/create",
    "/api/v1/admin/catalog/idols/rename",
    "/api/v1/admin/catalog/idols/status",
    "/api/v1/admin/catalog/owners/list",
    "/api/v1/admin/catalog/owners/read",
    "/api/v1/admin/content-authoring/copy",
    "/api/v1/admin/content-authoring/create",
    "/api/v1/admin/content-authoring/read",
    "/api/v1/admin/content-review/approve",
    "/api/v1/admin/content-review/preview/issue",
    "/api/v1/admin/content-review/preview/revoke",
    "/api/v1/admin/content-review/read",
    "/api/v1/admin/content-review/submit",
    "/api/v1/admin/exceptions/context",
    "/api/v1/admin/exceptions/detail",
    "/api/v1/admin/exceptions/list",
    "/api/v1/admin/exceptions/reconcile-payment",
    "/api/v1/admin/exceptions/replay-webhook",
    "/api/v1/admin/exceptions/retry-dead-letter",
    "/api/v1/admin/exceptions/retry-notification",
    "/api/v1/admin/finance/cancel",
    "/api/v1/admin/finance/detail",
    "/api/v1/admin/finance/list",
    "/api/v1/admin/finance/reconcile",
    "/api/v1/admin/finance/refund",
    "/api/v1/admin/gift-commerce/content/save",
    "/api/v1/admin/gift-commerce/context/read",
    "/api/v1/admin/gift-commerce/gifts/create",
    "/api/v1/admin/gift-commerce/gifts/read",
    "/api/v1/admin/gift-commerce/gifts/status",
    "/api/v1/admin/gift-commerce/inventory/adjust",
    "/api/v1/admin/gift-commerce/inventory/locations/create",
    "/api/v1/admin/gift-commerce/inventory/read",
    "/api/v1/admin/gift-commerce/prices/create",
    "/api/v1/admin/gift-commerce/prices/publish",
    "/api/v1/admin/gift-commerce/prices/read",
    "/api/v1/admin/gift-commerce/prices/rollback",
    "/api/v1/admin/gift-commerce/variants/save",
    "/api/v1/admin/home-layout/draft",
    "/api/v1/admin/home-layout/history",
    "/api/v1/admin/home-layout/publish",
    "/api/v1/admin/home-layout/read",
    "/api/v1/admin/home-layout/restore",
    "/api/v1/admin/management/context",
    "/api/v1/admin/management/list",
    "/api/v1/admin/management/operations/read",
    "/api/v1/admin/management/operations/retry",
    "/api/v1/admin/management/submit",
    "/api/v1/admin/management/uploads/prepare",
    "/api/v1/admin/orders/context",
    "/api/v1/admin/orders/deliver",
    "/api/v1/admin/orders/detail",
    "/api/v1/admin/orders/hold",
    "/api/v1/admin/orders/list",
    "/api/v1/admin/orders/message/read",
    "/api/v1/admin/orders/message/review",
    "/api/v1/admin/orders/note/add",
    "/api/v1/admin/orders/notes/read",
    "/api/v1/admin/orders/notification/resend",
    "/api/v1/admin/orders/prepare",
    "/api/v1/admin/orders/proof-uploads/begin",
    "/api/v1/admin/orders/proof-uploads/complete",
    "/api/v1/admin/orders/proofs/attach",
    "/api/v1/admin/orders/proofs/view",
    "/api/v1/admin/orders/proofs/withdraw",
    "/api/v1/admin/orders/resume",
    "/api/v1/admin/payment-configuration/approve",
    "/api/v1/admin/payment-configuration/publish",
    "/api/v1/admin/payment-configuration/read",
    "/api/v1/admin/payment-configuration/rollback",
    "/api/v1/admin/payment-configuration/save",
    "/api/v1/admin/payment-configuration/submit",
    "/api/v1/admin/payment-configuration/validate",
    "/api/v1/admin/resources/media/read",
    "/api/v1/admin/resources/media/rights",
    "/api/v1/admin/resources/policies/read",
    "/api/v1/admin/resources/policies/register",
    "/api/v1/admin/resources/processing/enqueue",
    "/api/v1/admin/resources/processing/read",
    "/api/v1/admin/resources/processing/retry",
    "/api/v1/admin/resources/uploads/begin",
    "/api/v1/admin/resources/uploads/complete",
    "/api/v1/admin/resources/uploads/read",
    "/api/v1/admin/session/read",
    "/api/v1/admin/storefront-theme/draft",
    "/api/v1/admin/storefront-theme/history",
    "/api/v1/admin/storefront-theme/publish",
    "/api/v1/admin/storefront-theme/read",
    "/api/v1/admin/storefront-theme/restore",
    "/api/v1/admin/translation-transfer/export",
    "/api/v1/admin/translation-transfer/import",
    "/api/v1/admin/translation-workspace/read",
    "/api/v1/cart",
    "/api/v1/cart/items",
    "/api/v1/cart/items/{itemId}",
    "/api/v1/cart/items/{itemId}/editor",
    "/api/v1/cart/validate",
    "/api/v1/carts",
    "/api/v1/checkout/current/status",
    "/api/v1/checkout/sessions",
    "/api/v1/checkout/sessions/{checkoutSessionId}/attempts",
    "/api/v1/checkout/sessions/{checkoutSessionId}/attempts/{attemptId}",
    "/api/v1/checkout/sessions/{checkoutSessionId}/attempts/{attemptId}/recover",
    "/api/v1/checkout/sessions/{checkoutSessionId}/capabilities",
    "/api/v1/checkout/sessions/{checkoutSessionId}/order-access",
    "/api/v1/checkout/sessions/{checkoutSessionId}/status",
    "/api/v1/content-review-preview/read",
    "/api/v1/gift-browse",
    "/api/v1/gift-content/{handle}",
    "/api/v1/gifts",
    "/api/v1/gifts/{handle}",
    "/api/v1/homepage",
    "/api/v1/idols",
    "/api/v1/idols/{handle}",
    "/api/v1/media/{mediaAssetId}",
    "/api/v1/order-access/exchange",
    "/api/v1/order-access/locate",
    "/api/v1/order-access/revoke",
    "/api/v1/orders/{publicOrderId}",
    "/api/v1/orders/{publicOrderId}/delivery-proofs/{proofId}/{rendition}",
    "/api/v1/policies/{policyKey}",
    "/api/v1/storefront-context",
    "/api/v1/storefront-gifts/{handle}",
    "/api/v1/storefront-homepage",
    "/api/v1/storefront-seo/catalog",
    "/api/v1/storefront-seo/entity",
    "/api/v1/storefront-seo/index",
    "/api/v1/storefront/home-layout",
    "/api/v1/storefront/storefront-theme",
    "/api/v1/webhooks/payments/{endpointId}",
  ]);
  expect(operation["operationId"]).toBe("receivePaymentWebhook");
  expect(operation["security"]).toEqual([
    {
      PaymentWebhookSignature: [],
      PaymentWebhookTimestamp: [],
    },
  ]);
  expect(securitySchemes).toEqual({
    OrderSession: expect.objectContaining({
      type: "apiKey",
      in: "cookie",
      name: "__Host-fan-order",
    }),
    OrderCsrf: expect.objectContaining({
      type: "apiKey",
      in: "header",
      name: "x-csrf-token",
    }),
    CartSession: expect.objectContaining({
      type: "apiKey",
      in: "cookie",
      name: "__Host-fan-cart",
    }),
    CartCsrf: expect.objectContaining({
      type: "apiKey",
      in: "header",
      name: "x-csrf-token",
    }),
    AdminSession: expect.objectContaining({
      type: "apiKey",
      in: "cookie",
      name: "__Host-fan-admin-session",
    }),
    AdminCsrf: expect.objectContaining({
      type: "apiKey",
      in: "header",
      name: "x-csrf-token",
    }),
    PaymentWebhookSignature: expect.objectContaining({
      type: "apiKey",
      in: "header",
      name: "X-Fan-Support-Signature",
    }),
    PaymentWebhookTimestamp: expect.objectContaining({
      type: "apiKey",
      in: "header",
      name: "X-Fan-Support-Timestamp",
    }),
  });

  const parameters = operation["parameters"] as JsonObject[];
  const generatedEndpointIdSchema = Object.fromEntries(
    Object.entries(
      z.toJSONSchema(paymentWebhookEndpointIdSchema, {
        target: "draft-2020-12",
        unrepresentable: "throw",
      }),
    ).filter(([key]) => key !== "$schema"),
  );
  expect(parameters).toEqual([
    expect.objectContaining({
      name: "endpointId",
      in: "path",
      required: true,
      schema: generatedEndpointIdSchema,
    }),
  ]);

  const requestBody = operation["requestBody"] as JsonObject;
  expect(requestBody["required"]).toBe(true);
  expect(requestBody["x-fan-support-max-body-bytes"]).toBe(49_152);
  expect(requestBody["x-fan-support-body-handling"]).toBe("exact-raw-bytes");
  const requestContent = requestBody["content"] as JsonObject;
  expect(Object.keys(requestContent).sort()).toEqual(
    [
      "application/*+json",
      "application/json",
      "application/octet-stream",
      "application/x-www-form-urlencoded",
      "text/plain",
    ].sort(),
  );
  for (const mediaType of Object.values(requestContent) as JsonObject[]) {
    expect(mediaType["schema"]).toEqual(
      expect.objectContaining({
        type: "string",
        format: "binary",
        maxLength: 49_152,
      }),
    );
  }

  const responses = operation["responses"] as JsonObject;
  expect(Object.keys(responses).sort()).toEqual(
    ["202", "400", "404", "409", "413", "503"].sort(),
  );
  const accepted = responses["202"] as JsonObject;
  expect(
    (
      ((accepted["content"] as JsonObject)["application/json"] as JsonObject)[
        "schema"
      ] as JsonObject
    )["$ref"],
  ).toBe("#/components/schemas/PaymentWebhookAcceptedResponse");
  for (const status of ["400", "404", "409", "413", "503"]) {
    const response = responses[status] as JsonObject;
    expect(
      (
        ((response["content"] as JsonObject)["application/json"] as JsonObject)[
          "schema"
        ] as JsonObject
      )["$ref"],
    ).toBe("#/components/schemas/PublicErrorEnvelope");
    expect((response["headers"] as JsonObject)["X-Request-ID"]).toBeDefined();
  }
  expect((accepted["headers"] as JsonObject)["X-Request-ID"]).toBeDefined();
  expect(
    ((responses["503"] as JsonObject)["headers"] as JsonObject)["Retry-After"],
  ).toBeDefined();
  for (const status of ["202", "400", "404", "409", "413"]) {
    expect(
      ((responses[status] as JsonObject)["headers"] as JsonObject)[
        "Retry-After"
      ],
    ).toBeUndefined();
  }

  expect(schemas["PaymentWebhookAcceptedResponse"]).toBeDefined();
  expect(JSON.stringify(withoutPaymentConfiguration(openapi))).not.toContain(
    "providerAccountId",
  );
  const publicDocument = JSON.stringify(openapi);
  for (const forbidden of [
    "ReceivePaymentWebhookCommand",
    "rawBodyBase64",
    "verificationKeyReferenceHash",
    "webhookInboxId",
    "providerEventRowId",
  ]) {
    expect(publicDocument).not.toContain(forbidden);
  }
});

test("marks every registered top-level contract with an explicit version policy", async () => {
  const [{ createContractArtifactDocuments }, { contractArtifactRegistry }] =
    await Promise.all([
      import("./artifact-documents.js"),
      import("./artifact-registry.js"),
    ]);
  const definitions = createContractArtifactDocuments().jsonSchema[
    "$defs"
  ] as JsonObject;
  const unversionedValueObjects = new Set([
    "AdminOrdersPermission",
    "AdminOrdersListItem",
    "AdminOrdersLine",
    "AdminOrdersNoteMetadata",
    "AdminOrdersNotification",
    "AdminOrdersPrincipal",
    "AdminOrdersNoteEnvelope",
    "AdminOrdersProof",
    "OrderAccessDeliveryProof",

    "OrderNotificationUrl",
    "CheckoutPolicyAcceptance",
    "CheckoutEncryptedContact",
    "CheckoutInventoryAssignment",
    "ManagementCenterPrice",
    "ManagementCenterInventory",
    "ManagementCenterIntent",
    "ManagementCenterOperation",
    "ManagementCenterListItem",
    "ManagementCenterPreparedMedia",
    "ManagementCenterCheckpoint",
    "DailyPublicationCurrentMedia",
    "SupportedLocale",
    "TranslationSnapshotRef",
    "MediaSnapshot",
  ]);

  for (const registration of contractArtifactRegistry) {
    expect(registration.versionedRoot).toBe(
      !unversionedValueObjects.has(registration.name),
    );
    if (registration.versionedRoot) {
      expect(
        isStrictVersionedRoot(definitions[registration.name] as JsonObject),
        `${registration.name} must reject unknown versions and unknown keys`,
      ).toBe(true);
    }
  }
});

test("keeps committed contract artifacts byte-for-byte fresh", async () => {
  const artifacts = await import("./artifact-documents.js");
  const rendered = artifacts.renderContractArtifactDocuments();
  const [jsonSchema, openapi] = await Promise.all([
    readFile(
      new URL("../generated/contracts.schema.json", import.meta.url),
      "utf8",
    ).catch(() => undefined),
    readFile(
      new URL("../generated/openapi.json", import.meta.url),
      "utf8",
    ).catch(() => undefined),
  ]);

  expect(jsonSchema, "committed JSON Schema artifact must exist").toBeDefined();
  expect(openapi, "committed OpenAPI artifact must exist").toBeDefined();
  expect(jsonSchema).toBe(rendered.jsonSchema);
  expect(openapi).toBe(rendered.openapi);
});

test("describes real public directory operations with explicit language and commerce context", async () => {
  const { createContractArtifactDocuments } =
    await import("./artifact-documents.js");
  const paths = createContractArtifactDocuments().openapi[
    "paths"
  ] as JsonObject;
  for (const [path, responseName] of [
    ["/api/v1/idols", "IdolDirectoryResponse"],
    ["/api/v1/gifts", "GiftDirectoryResponse"],
  ]) {
    const route = paths[path!] as JsonObject | undefined;
    expect(route, path).toBeDefined();
    const operation = route!["get"] as JsonObject;
    expect(operation["security"]).toEqual([]);
    expect(JSON.stringify(operation)).toContain(responseName);
    const parameters = operation["parameters"] as JsonObject[];
    expect(
      parameters.some((p) => p["name"] === "locale" && p["required"] === true),
    ).toBe(true);
    expect(parameters.some((p) => p["name"] === "schemaVersion")).toBe(false);
    if (path === "/api/v1/gifts")
      for (const name of ["market", "currency"])
        expect(
          parameters.some((p) => p["name"] === name && p["required"] === true),
        ).toBe(true);
  }
});

test("maps the public idol query parameter to the internal gift recipient field", async () => {
  const { createContractArtifactDocuments } =
    await import("./artifact-documents.js");
  const paths = createContractArtifactDocuments().openapi[
    "paths"
  ] as JsonObject;
  const get = (paths["/api/v1/gifts"] as JsonObject)["get"] as JsonObject;
  const names = (get["parameters"] as JsonObject[]).map((p) => p["name"]);
  expect(names).toContain("idol");
  expect(names).not.toContain("idolId");
});
