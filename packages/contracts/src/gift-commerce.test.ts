import { describe, expect, test } from "vitest";
import {
  giftCommerceAuthorizationCommandSchema,
  giftCommerceCommandSchema,
  giftCommerceRequestSchema,
  giftCommerceResponseSchema,
  giftCommerceMutationSchema,
  giftCommerceGiftSchema,
  giftCommerceReadResponseSchema,
  giftCommerceRawContextSchema,
} from "./gift-commerce.js";
import {
  giftRevisionProfileSchema,
  giftPublicationProfileSchema,
} from "./gift-commerce-profile.js";

const giftId = "76189879-4be8-4fe2-a583-09926fdbb93e";
const variantId = "aa24a76f-172c-427c-b104-82601b0e98bc";
const revisionId = "8dfca214-ea76-4ffb-9f4e-4b027861bbfa";
const actorId = "a6e9ee96-65e7-4725-a777-734b5f27748d";
const hash = "a".repeat(64);
const time = "2026-09-07T08:00:00.000001Z";
const write = {
  reasonCode: "OPERATOR_EDIT",
  idempotencyKey: "gift-commerce-edit-001",
};
const create = {
  schemaVersion: 1,
  action: "CREATE_GIFT",
  handle: "sample-gift",
  expectedBaseVersion: 0,
  ...write,
};
const saveVariant = {
  schemaVersion: 1,
  action: "SAVE_VARIANT",
  giftId,
  giftVariantId: null,
  expectedBaseVersion: 1,
  expectedVariantVersion: 0,
  sku: "GIFT-001",
  status: "draft",
  inventoryPolicy: "PROCURE_ON_DEMAND",
  eligibleIdolIds: [],
  ...write,
};
const price = {
  schemaVersion: 1,
  action: "CREATE_PRICE_REVISION",
  market: "DEMO",
  currency: "USD",
  expectedBookRevision: 0,
  expectedHeadVersion: 0,
  source: null,
  validFrom: time,
  validUntil: null,
  changes: [{ giftVariantId: variantId, unitAmountMinor: 1250 }],
  ...write,
};
const adjust = {
  schemaVersion: 1,
  action: "ADJUST_INVENTORY",
  giftVariantId: variantId,
  inventoryLocationId: revisionId,
  expectedVariantVersion: 1,
  expectedBalanceVersion: 0,
  deltaOnHand: 10,
  ...write,
};
const profile = {
  schemaVersion: 1,
  giftId,
  giftRevisionId: revisionId,
  giftKind: "WISH",
  createdBy: actorId,
  createdAt: time,
  profileHash: hash,
};
function accepts(input: unknown) {
  return giftCommerceCommandSchema.safeParse(input).success;
}

describe("gift commerce commands keep independent business dimensions", () => {
  test("gift identity starts as draft at version zero without browser IDs or lifecycle", () => {
    expect(accepts(create)).toBe(true);
    for (const fields of [
      { giftId },
      { status: "active" },
      { expectedBaseVersion: 1 },
      { giftKind: "WISH" },
    ])
      expect(accepts({ ...create, ...fields })).toBe(false);
  });
  test("variant creation has an explicit zero version and cannot start active", () => {
    expect(accepts(saveVariant)).toBe(true);
    for (const fields of [
      { expectedVariantVersion: 1 },
      { status: "active" },
      { giftVariantId: variantId },
      { reserved: 3 },
    ])
      expect(accepts({ ...saveVariant, ...fields })).toBe(false);
  });
  test("existing variant edit binds both parent and variant versions", () => {
    const existing = {
      ...saveVariant,
      giftVariantId: variantId,
      expectedVariantVersion: 2,
      status: "active",
      eligibleIdolIds: [actorId],
    };
    expect(accepts(existing)).toBe(true);
    for (const fields of [
      { expectedBaseVersion: 0 },
      { expectedVariantVersion: 0 },
      { eligibleIdolIds: [actorId, actorId.toUpperCase()] },
      { inventoryPolicy: "UNLIMITED" },
    ])
      expect(accepts({ ...existing, ...fields })).toBe(false);
  });
  test.each(["TRACKED", "PROCURE_ON_DEMAND", "PREORDER"])(
    "stock policy %s does not infer gift kind or a delivery state",
    (inventoryPolicy) => {
      expect(accepts({ ...saveVariant, inventoryPolicy })).toBe(true);
      expect(
        accepts({
          ...saveVariant,
          inventoryPolicy,
          fulfillmentStatus: "DELIVERED",
        }),
      ).toBe(false);
    },
  );
  test("status writes bind base version and do not mutate handle or kind", () => {
    const input = {
      schemaVersion: 1,
      action: "SET_GIFT_STATUS",
      giftId,
      expectedBaseVersion: 3,
      status: "paused",
      ...write,
    };
    expect(accepts(input)).toBe(true);
    for (const fields of [
      { expectedBaseVersion: 0 },
      { status: "draft" },
      { newHandle: "new-name" },
      { giftKind: "VIRTUAL" },
    ])
      expect(accepts({ ...input, ...fields })).toBe(false);
  });
  test("content writes wrap exact GIFT authoring only, with one idempotency owner", () => {
    const content = {
      schemaVersion: 1,
      action: "COPY",
      target: { kind: "GIFT", giftId },
      sourceRevisionId: revisionId,
      expectedVersion: 2,
      expectedSourceHash: hash,
      changes: { kind: "GIFT" },
    };
    const input = {
      schemaVersion: 1,
      action: "SAVE_GIFT_CONTENT",
      expectedBaseVersion: 3,
      giftKind: "WISH",
      authoring: content,
      ...write,
    };
    expect(accepts(input)).toBe(true);
    for (const authoring of [
      { ...content, idempotencyKey: "nested" },
      { ...content, target: { kind: "IDOL", idolId: giftId } },
      { ...content, changes: { kind: "POLICY" } },
    ])
      expect(accepts({ ...input, authoring })).toBe(false);
  });
});

describe("price revision and inventory mutation boundaries", () => {
  test("price revisions patch a server-copied full book with integer minor units", () => {
    expect(accepts(price)).toBe(true);
    for (const unitAmountMinor of [
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      "12.50",
    ])
      expect(
        accepts({
          ...price,
          changes: [{ giftVariantId: variantId, unitAmountMinor }],
        }),
      ).toBe(false);
    for (const fields of [
      { changes: [] },
      { entries: price.changes },
      { changes: [price.changes[0], price.changes[0]] },
      { source: { priceBookId: giftId, revision: 1, contentHash: hash } },
    ])
      expect(accepts({ ...price, ...fields })).toBe(false);
  });
  test("historical source is allowed without conflating current head and latest authoring version", () => {
    const input = {
      ...price,
      expectedBookRevision: 5,
      expectedHeadVersion: 3,
      source: { priceBookId: giftId, revision: 2, contentHash: hash },
    };
    expect(accepts(input)).toBe(true);
    for (const fields of [
      { source: null },
      { source: { ...input.source, revision: 6 } },
      { expectedBookRevision: 0 },
    ])
      expect(accepts({ ...input, ...fields })).toBe(false);
  });
  test("new price windows retain PostgreSQL microsecond ordering and reject extra precision", () => {
    expect(
      accepts({ ...price, validUntil: "2026-09-07T08:00:00.000002Z" }),
    ).toBe(true);
    for (const validUntil of [
      time,
      "2026-09-07T08:00:00.000000Z",
      "2026-09-07T08:00:00.0000011Z",
    ])
      expect(accepts({ ...price, validUntil })).toBe(false);
  });
  test.each(["PUBLISH_PRICE_BOOK", "ROLLBACK_PRICE_BOOK"])(
    "%s binds immutable source and publication head",
    (action) => {
      const input = {
        schemaVersion: 1,
        action,
        market: "DEMO",
        currency: "USD",
        priceBookId: giftId,
        revision: 2,
        expectedHeadVersion: 3,
        expectedContentHash: hash,
        ...write,
      };
      expect(accepts(input)).toBe(true);
      expect(accepts({ ...input, expectedVersion: 3 })).toBe(false);
      expect(accepts({ ...input, expectedContentHash: undefined })).toBe(false);
    },
  );
  test("inventory initializes through version zero while the browser cannot alter reserved units", () => {
    expect(accepts(adjust)).toBe(true);
    expect(
      accepts({ ...adjust, expectedBalanceVersion: 4, deltaOnHand: -2 }),
    ).toBe(true);
    for (const fields of [
      { deltaOnHand: 0 },
      { deltaOnHand: -1 },
      { deltaReserved: 2 },
      { onHand: 99 },
      { actorId },
      { occurredAt: time },
      { expectedVariantVersion: 0 },
    ])
      expect(accepts({ ...adjust, ...fields })).toBe(false);
  });
  test("location registration starts version zero and uses actual database code constraints", () => {
    const input = {
      schemaVersion: 1,
      action: "CREATE_INVENTORY_LOCATION",
      code: "STUDIO_MAIN",
      expectedVersion: 0,
      ...write,
    };
    expect(accepts(input)).toBe(true);
    for (const fields of [
      { expectedVersion: 1 },
      { code: "A" },
      { status: "ACTIVE" },
      { inventoryLocationId: giftId },
    ])
      expect(accepts({ ...input, ...fields })).toBe(false);
  });
  test("read pagination is bounded and mutable inventory is never an unbounded ledger dump", () => {
    const input = {
      schemaVersion: 1,
      action: "READ_INVENTORY",
      giftVariantId: variantId,
      inventoryLocationId: null,
      view: "BALANCES",
      page: 1,
      pageSize: 20,
    };
    expect(accepts(input)).toBe(true);
    for (const fields of [
      { page: 0 },
      { page: 1001 },
      { pageSize: 51 },
      { view: "PRIVATE_ORDER" },
    ])
      expect(accepts({ ...input, ...fields })).toBe(false);
  });
});

describe("gift revision classification and publication binding", () => {
  test.each(["VIRTUAL", "PHYSICAL", "WISH", "MERCHANDISE", "OTHER"])(
    "%s remains independent of old category and fulfillment contracts",
    (giftKind) => {
      expect(
        giftRevisionProfileSchema.safeParse({ ...profile, giftKind }).success,
      ).toBe(true);
    },
  );
  test("profile proof is typed to the exact gift/revision and old base manifest", () => {
    const proof = {
      schemaVersion: 1,
      publicationId: variantId,
      giftId,
      giftRevisionId: revisionId,
      manifestHash: hash,
      profile,
    };
    expect(giftPublicationProfileSchema.safeParse(proof).success).toBe(true);
    expect(
      giftPublicationProfileSchema.safeParse({
        ...proof,
        giftRevisionId: actorId,
      }).success,
    ).toBe(false);
    expect(
      giftPublicationProfileSchema.safeParse({ ...proof, giftId: actorId })
        .success,
    ).toBe(false);
    expect(
      giftRevisionProfileSchema.safeParse({ ...profile, stock: "unlimited" })
        .success,
    ).toBe(false);
  });
});

describe("commerce envelope and response privacy", () => {
  test("historical gift selection carries its own profile instead of the latest kind", () => {
    expect(
      accepts({
        schemaVersion: 1,
        action: "READ_GIFT",
        giftId,
        locale: "ja",
        revisionId,
      }),
    ).toBe(true);
    const value = {
      schemaVersion: 1,
      gift: {
        schemaVersion: 1,
        id: giftId,
        handle: "sample-gift",
        status: "draft",
        draftRevisionId: revisionId,
        publishedRevisionId: null,
        version: 1,
      },
      locale: "ja",
      label: null,
      authoringVersion: 1,
      publicationHeadVersion: 0,
      latestRevisionId: revisionId,
      latestProfile: { kind: "PROFILE", profile },
      publishedProfile: null,
      selectedRevisionId: revisionId,
      selectedProfile: { kind: "PROFILE", profile },
      variants: [],
    };
    expect(giftCommerceGiftSchema.safeParse(value).success).toBe(true);
    expect(
      giftCommerceGiftSchema.safeParse({
        ...value,
        selectedRevisionId: actorId,
      }).success,
    ).toBe(false);
    expect(
      giftCommerceGiftSchema.safeParse({ ...value, selectedProfile: null })
        .success,
    ).toBe(false);
  });
  test("inventory reads bind every row to the actual variant/item and selected location", () => {
    const item = {
      schemaVersion: 1,
      id: giftId,
      giftVariantId: variantId,
      sku: "GIFT-001",
      policy: "TRACKED",
      status: "ACTIVE",
    };
    const balance = {
      schemaVersion: 1,
      inventoryItemId: giftId,
      inventoryLocationId: revisionId,
      onHand: 2,
      reserved: 1,
      version: 1,
    };
    const response = {
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "INVENTORY_BALANCES",
      giftVariantId: variantId,
      inventoryLocationId: revisionId,
      item,
      items: [balance],
      page: 1,
      pageSize: 20,
      totalItems: 1,
    };
    expect(giftCommerceReadResponseSchema.safeParse(response).success).toBe(
      true,
    );
    for (const fields of [
      { item: null },
      { giftVariantId: actorId },
      { inventoryLocationId: actorId },
      { items: [{ ...balance, inventoryItemId: actorId }] },
      { items: [balance, balance] },
      { totalItems: 0 },
    ])
      expect(
        giftCommerceReadResponseSchema.safeParse({ ...response, ...fields })
          .success,
      ).toBe(false);
  });
  test("discovered contexts have distinct canonical market and location identities", () => {
    const market = { marketId: giftId, market: "DEMO", currencies: ["USD"] };
    const location = {
      schemaVersion: 1,
      id: revisionId,
      code: "STUDIO_MAIN",
      status: "ACTIVE",
    };
    const response = {
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "COMMERCE_CONTEXT",
      markets: [market],
      inventoryLocations: [location],
    };
    expect(giftCommerceRawContextSchema.safeParse(response).success).toBe(true);
    expect(
      giftCommerceRawContextSchema.safeParse({
        ...response,
        markets: [market, market],
      }).success,
    ).toBe(false);
    expect(
      giftCommerceRawContextSchema.safeParse({
        ...response,
        inventoryLocations: [location, location],
      }).success,
    ).toBe(false);
  });
  test("new permissions stay in the new authorization root with canonical token digests", () => {
    const input = {
      schemaVersion: 1,
      sessionTokenDigest: hash,
      csrfTokenDigest: hash,
      permission: "gift.manage",
      locales: ["ja"],
    };
    expect(
      giftCommerceAuthorizationCommandSchema.safeParse(input).success,
    ).toBe(true);
    for (const fields of [
      { permission: "refund.manage" },
      { locales: ["ja", "ja"] },
      { actorId },
      { sessionToken: "secret" },
    ])
      expect(
        giftCommerceAuthorizationCommandSchema.safeParse({
          ...input,
          ...fields,
        }).success,
      ).toBe(false);
  });
  test("browser requests cannot supply session identity or audit evidence", () => {
    const input = {
      schemaVersion: 1,
      requestId: giftId,
      sessionToken: "A".repeat(43),
      csrfToken: "E".repeat(43),
      command: create,
    };
    expect(giftCommerceRequestSchema.safeParse(input).success).toBe(true);
    expect(
      giftCommerceRequestSchema.safeParse({ ...input, actorId }).success,
    ).toBe(false);
    expect(
      giftCommerceRequestSchema.safeParse({
        ...input,
        sessionToken: "B".repeat(43),
      }).success,
    ).toBe(false);
  });
  test("mutations expose a safe typed receipt and never a replayed private body", () => {
    const result = {
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "MUTATION",
      action: "CREATE_GIFT",
      resultId: revisionId,
      giftId,
      baseVersion: 1,
      replayed: false,
    };
    expect(giftCommerceMutationSchema.safeParse(result).success).toBe(true);
    expect(giftCommerceResponseSchema.safeParse(result).success).toBe(true);
    expect(
      giftCommerceResponseSchema.safeParse({
        ...result,
        sessionToken: "secret",
      }).success,
    ).toBe(false);
    expect(
      giftCommerceMutationSchema.safeParse({
        ...result,
        action: "ADJUST_INVENTORY",
      }).success,
    ).toBe(false);
  });
});
