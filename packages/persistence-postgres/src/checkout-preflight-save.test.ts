import { expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  checkoutPreflightCommitCommandSchema,
  checkoutPreflightObservationSchema,
} from "@fan-support/contracts";
import {
  canonicalPublicationValue,
  hashPublicationValue,
} from "@fan-support/content";
import { createCheckoutPreflightRepository } from "./checkout-preflight-repository.js";
const { current } = vi.hoisted(() => ({ current: vi.fn() }));
vi.mock("./checkout-preflight-current.js", () => ({
  loadCheckoutCurrent: current,
}));
const id = () => randomUUID();
const createdAt = "2026-09-08T00:00:00.123456Z",
  expiresAt = "2026-09-08T00:15:00.123456Z";
// Structurally valid TEST input exercises the real row builders only. It is never inserted
// and does not purport to be a verified publication, encrypted contact or completed checkout.
const source = {
  schemaVersion: 1,
  mode: "DAILY",
  publicationMode: "DIRECT_OPERATOR_V1",
  publicationId: id(),
  revisionId: id(),
  manifestHash: "a".repeat(64),
  sourceHash: "b".repeat(64),
  sourceLocale: "zh-CN",
  requestedLocale: "en",
  resolvedLocale: "zh-CN",
  translationRevisionId: id(),
  fallbackUsed: true,
};
const media = {
  schemaVersion: 1,
  assetId: id(),
  checksum: "c".repeat(64),
  objectKey: "test/checkout-parameters.webp",
  metadataRevisionId: source.revisionId,
  alt: "TEST image",
  altTranslation: source,
};
const line = {
  schemaVersion: 1,
  cartItemId: id(),
  itemVersion: 1,
  supportIntentId: id(),
  intentVersion: 1,
  fulfillmentProfileId: id(),
  idolId: id(),
  idolHandle: "test-idol",
  idolDisplayName: "TEST idol",
  idolTranslation: source,
  idolPortrait: media,
  giftId: id(),
  giftVariantId: id(),
  giftTitle: "TEST gift",
  giftVariantLabel: "TEST variant",
  giftTranslation: source,
  giftImage: media,
  observedPriceId: id(),
  priceId: id(),
  priceRevision: 1,
  unitAmountMinor: 25,
  quantity: 2,
  displayMode: "anonymous",
  inventoryPolicy: "PROCURE_ON_DEMAND",
  inventoryItemId: null,
  eligibility: "ALL_ACTIVE_ARTISTS",
};
const consent = {
  schemaVersion: 1,
  cartId: id(),
  cartVersion: 2,
  presentationLocale: "en",
  market: "TEST",
  currency: "USD",
  lines: [line],
  policies: [
    {
      schemaVersion: 1,
      policyKey: "terms",
      kind: "TERMS",
      locale: "en",
      policyRevisionId: id(),
      policyTranslationRevisionId: id(),
      publicationId: id(),
      manifestHash: "d".repeat(64),
      sourceHash: "e".repeat(64),
      title: "TEST terms",
      body: "TEST policy",
      effectiveAt: "2026-09-07T00:00:00.000Z",
    },
  ],
};
const observation = checkoutPreflightObservationSchema.parse({
  schemaVersion: 1,
  id: id(),
  consentHash: hashPublicationValue("fan-support.checkout-consent.v1", consent),
  consent,
  createdAt,
  expiresAt,
  quote: {
    schemaVersion: 1,
    id: id(),
    cartVersion: 2,
    expiresAt,
    amount: {
      schemaVersion: 1,
      market: "TEST",
      currency: "USD",
      quoteRevision: 1,
      quoteExpiresAt: expiresAt,
      subtotalMinor: 50,
      taxAmountMinor: 0,
      shippingAmountMinor: 0,
      feeAmountMinor: 0,
      discountAmountMinor: 0,
      totalAmountMinor: 50,
    },
    lines: [
      {
        schemaVersion: 1,
        cartItemId: line.cartItemId,
        giftVariantId: line.giftVariantId,
        priceId: line.priceId,
        priceRevision: 1,
        quantity: 2,
        unitAmountMinor: 25,
        lineSubtotalMinor: 50,
        taxAmountMinor: 0,
        discountAmountMinor: 0,
        lineTotalMinor: 50,
      },
    ],
  },
});
const command = checkoutPreflightCommitCommandSchema.parse({
  schemaVersion: 1,
  accesses: [
    {
      schemaVersion: 1,
      tokenDigest: "f".repeat(64),
      pepperVersion: "test-checkout-parameter",
    },
  ],
  cartId: consent.cartId,
  preflightId: observation.id,
  expectedCartVersion: 2,
  expectedConsentHash: observation.consentHash,
  checkoutSessionId: id(),
  orderId: id(),
  publicOrderId: id(),
  contact: {
    id: id(),
    emailCiphertext: "enc:v1:" + "a".repeat(40),
    encryptedDataKey: "enc:v1:" + "b".repeat(40),
    encryptionKeyVersion: "test-parameter",
    emailLookupHmac: "a".repeat(64),
    lookupKeyVersion: "test-parameter",
  },
  items: [
    {
      cartItemId: line.cartItemId,
      orderItemId: id(),
      fulfillmentId: id(),
      fulfillmentEventId: id(),
    },
  ],
  createdOrderEventId: id(),
  pendingOrderEventId: id(),
  eventId: id(),
  requestId: id(),
  correlationId: id(),
});

test("stored consent is the exact canonical JSON whose hash PostgreSQL validates", async () => {
  const cart = {
    id: consent.cartId,
    version: "2",
    status: "ACTIVE",
    expired: false,
    presentation_locale: "en",
    market: "TEST",
    currency: "USD",
    expires_at: expiresAt,
    created_at: createdAt,
    updated_at: createdAt,
  };
  current.mockResolvedValue({
    cart: { id: consent.cartId },
    consent: observation.consent,
  });
  const query = vi.fn(async (sql: string, parameters?: readonly unknown[]) => {
    void parameters;
    return sql.includes("FROM public.carts")
      ? { rows: [cart] }
      : sql.includes(" fresh ")
        ? { rows: [{ fresh: true }] }
        : { rows: [] };
  });
  const repo = createCheckoutPreflightRepository(
    { query, release: vi.fn() },
    { markRollbackOnly: vi.fn(), trackOperation: async (work) => work() },
    "https://media.example.test",
  );
  await repo.loadCurrent({
    schemaVersion: 1,
    accesses: command.accesses,
    cartId: command.cartId,
    expectedCartVersion: 2,
    presentationLocale: "en",
  });
  await repo.savePreflight({
    schemaVersion: 1,
    accesses: command.accesses,
    cartId: command.cartId,
    observation,
  });
  const call = query.mock.calls.find(([sql]) =>
    sql.startsWith("INSERT INTO public.checkout_preflight_observations"),
  );
  expect(call).toBeDefined();
  const parameters = call![1]!;
  expect(parameters[4]).toBe(canonicalPublicationValue(observation));
  expect(
    JSON.parse(parameters[4] as string).consent.policies[0].effectiveAt,
  ).toBe("2026-09-07T00:00:00.000000Z");
});
