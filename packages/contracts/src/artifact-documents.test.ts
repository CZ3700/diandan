import { readFile } from "node:fs/promises";

import { expect, test } from "vitest";

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
    "schema-components",
  );
  expect(documents.openapi["paths"]).toEqual({});
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
