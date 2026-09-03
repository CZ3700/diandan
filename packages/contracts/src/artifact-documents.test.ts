import { readFile } from "node:fs/promises";

import { expect, test } from "vitest";
import { z } from "zod";

import { paymentWebhookEndpointIdSchema } from "./identifiers.js";

type JsonObject = Record<string, unknown>;

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
    schemaVersion?.["const"] === 1 &&
    required?.includes("schemaVersion") === true
  );
}

test("renders deterministic JSON Schema and OpenAPI documents from one registry", async () => {
  const [artifacts, registry] = await Promise.all([
    import("./artifact-documents.js").catch(() => undefined),
    import("./artifact-registry.js").catch(() => undefined),
  ]);

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

  const renderedOpenapi = JSON.stringify(documents.openapi);
  for (const forbiddenField of [
    "fanMessageCiphertext",
    "displayNameCiphertext",
    "encryptedDataKey",
    "encryptionKeyVersion",
    "objectKey",
    "supportIntentId",
    "providerAccountId",
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

  expect(Object.keys(paths)).toEqual([
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
  const publicDocument = JSON.stringify(openapi);
  for (const forbidden of [
    "ReceivePaymentWebhookCommand",
    "rawBodyBase64",
    "providerAccountId",
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
