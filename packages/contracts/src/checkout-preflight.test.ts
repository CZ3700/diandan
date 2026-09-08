import { describe, expect, it } from "vitest";
import { translationSnapshotRefSchema } from "./order.js";

const id = "10000000-0000-4000-8000-000000000001";
const hash = "a".repeat(64);
const original = {
  schemaVersion: 1,
  mode: "DAILY",
  publicationMode: "DIRECT_OPERATOR_V1",
  publicationId: id,
  revisionId: id,
  manifestHash: hash,
  sourceHash: hash,
  sourceLocale: "zh-CN",
  requestedLocale: "en",
  resolvedLocale: "zh-CN",
  translationRevisionId: id,
  fallbackUsed: true,
};
const load = () => import("./checkout-preflight.js").catch(() => null);

describe("checkout preflight additive contracts", () => {
  it("records the actual original without weakening the old English-fallback contract", async () => {
    const schemas = await load();
    expect(
      schemas?.checkoutTranslationSnapshotSchema.safeParse(original).success,
    ).toBe(true);
    expect(
      translationSnapshotRefSchema.safeParse({
        requestedLocale: "en",
        resolvedLocale: "zh-CN",
        translationRevisionId: id,
        fallbackUsed: true,
      }).success,
    ).toBe(false);
  });
  it("rejects invented daily source or approval fields", async () => {
    const schemas = await load();
    expect(schemas).not.toBeNull();
    for (const changes of [
      { resolvedLocale: "en" },
      { fallbackUsed: false },
      { sourceLocale: "ja" },
      { approvalId: id },
    ])
      expect(
        schemas?.checkoutTranslationSnapshotSchema.safeParse({
          ...original,
          ...changes,
        }).success,
      ).toBe(false);
  });
  it("retains legacy approved provenance with an exact request language", async () => {
    const schemas = await load();
    const legacy = { ...original };
    Reflect.deleteProperty(legacy, "publicationMode");
    Reflect.deleteProperty(legacy, "sourceLocale");
    expect(
      schemas?.checkoutTranslationSnapshotSchema.safeParse({
        ...legacy,
        mode: "APPROVED",
        resolvedLocale: "en",
        fallbackUsed: false,
      }).success,
    ).toBe(true);
  });
  it("takes no browser amounts or snapshots when creating checkout", async () => {
    const schemas = await load();
    const command = {
      schemaVersion: 1,
      operation: "CREATE_CHECKOUT",
      preflightId: id,
      expectedCartVersion: 2,
      email: "test@example.test",
      policyAcceptances: [
        {
          policyKey: "terms",
          policyRevisionId: id,
          policyTranslationRevisionId: id,
          accepted: true,
        },
      ],
    };
    expect(
      schemas?.checkoutPreflightCreateCommandSchema.safeParse(command).success,
    ).toBe(true);
    for (const changes of [
      { amountMinor: 1 },
      { presentationLocale: "ja" },
      { policyAcceptances: [] },
      { email: "invalid" },
      {
        policyAcceptances: [
          command.policyAcceptances[0],
          command.policyAcceptances[0],
        ],
      },
    ])
      expect(
        schemas?.checkoutPreflightCreateCommandSchema.safeParse({
          ...command,
          ...changes,
        }).success,
      ).toBe(false);
  });
  it("validates an exact cart version and permits no payment-provider input", async () => {
    const schemas = await load();
    const command = {
      schemaVersion: 1,
      operation: "VALIDATE_CHECKOUT",
      expectedCartVersion: 2,
      presentationLocale: "ja",
    };
    expect(
      schemas?.checkoutPreflightValidateCommandSchema.safeParse(command)
        .success,
    ).toBe(true);
    expect(
      schemas?.checkoutPreflightValidateCommandSchema.safeParse({
        ...command,
        provider: "test",
      }).success,
    ).toBe(false);
  });
  it("uses safe schema-versioned errors without raw adapter messages", async () => {
    const schemas = await load();
    expect(
      schemas?.checkoutPreflightFailureSchema.safeParse({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "PREFLIGHT_CHANGED",
      }).success,
    ).toBe(true);
    expect(
      schemas?.checkoutPreflightFailureSchema.safeParse({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "PREFLIGHT_CHANGED",
        email: "test@example.test",
      }).success,
    ).toBe(false);
  });
  it("binds media alt provenance to its exact metadata revision", async () => {
    const schemas = await load();
    const media = {
      schemaVersion: 1,
      assetId: id,
      checksum: hash,
      objectKey: "test/image.webp",
      metadataRevisionId: id,
      alt: "原图",
      altTranslation: original,
    };
    expect(schemas?.checkoutMediaSnapshotSchema.safeParse(media).success).toBe(
      true,
    );
    expect(
      schemas?.checkoutMediaSnapshotSchema.safeParse({
        ...media,
        metadataRevisionId: "10000000-0000-4000-8000-000000000002",
      }).success,
    ).toBe(false);
    expect(schemas?.checkoutText(1).safeParse("🎁").success).toBe(true);
    expect(schemas?.checkoutText(1).safeParse("\ud800").success).toBe(false);
  });
});
