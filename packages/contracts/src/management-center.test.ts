import { describe, expect, it } from "vitest";
import {
  managementCenterIntentSchema,
  managementCenterOperationSchema,
  managementCenterCommandSchema,
  managementCenterResponseSchema,
  managementCenterListItemSchema,
} from "./management-center.js";

const id = "00000000-0000-4000-8000-000000000001";
const artist = {
  kind: "SAVE_ARTIST",
  sourceLocale: "th",
  id: null,
  expectedVersion: 0,
  name: "ศิลปิน",
  description: "คำอธิบาย",
  image: { uploadId: id },
};
const gift = {
  ...artist,
  kind: "SAVE_GIFT",
  giftKind: "VIRTUAL",
  category: "OTHER",
  price: { market: "TEST", currency: "USD", amountMinor: 1000 },
  inventory: { policy: "PROCURE_ON_DEMAND" },
  eligibility: { rule: "ALL_ACTIVE_ARTISTS" },
};
describe("management list filters and sort prices", () => {
  const list = {
    schemaVersion: 1,
    action: "LIST",
    section: "ARTISTS",
    page: 1,
    pageSize: 12,
  };
  const accepts = (value: unknown) =>
    managementCenterCommandSchema.safeParse(value).success;
  it("combines bounded literal artist search with assignment only for artists", () => {
    expect(
      accepts({
        ...list,
        search: "艺人%_",
        assignment: { kind: "UNASSIGNED" },
      }),
    ).toBe(true);
    for (const search of ["", " ", " name", "name\n", "a".repeat(81)])
      expect(accepts({ ...list, search })).toBe(false);
    for (const section of ["GIFTS", "POSTERS"])
      expect(accepts({ ...list, section, search: "Artist" })).toBe(false);
  });
  it("accepts gift kinds and a closed sort vocabulary without altering old requests", () => {
    expect(managementCenterCommandSchema.parse(list)).toEqual(list);
    for (const giftKind of [
      "VIRTUAL",
      "PHYSICAL",
      "WISH",
      "MERCHANDISE",
      "OTHER",
    ])
      for (const sort of [undefined, "NEWEST", "PRICE_ASC", "PRICE_DESC"])
        expect(
          accepts({
            ...list,
            section: "GIFTS",
            giftKind,
            ...(sort ? { sort } : {}),
          }),
        ).toBe(true);
    for (const extra of [
      { giftKind: "FLOWERS" },
      { sort: "RANDOM()" },
      { market: "US" },
      { currency: "USD" },
    ])
      expect(accepts({ ...list, section: "GIFTS", ...extra })).toBe(false);
    for (const section of ["ARTISTS", "POSTERS"])
      for (const extra of [{ giftKind: "VIRTUAL" }, { sort: "NEWEST" }])
        expect(accepts({ ...list, section, ...extra })).toBe(false);
  });
  it("binds optional sort prices to the list scope while retaining the original edit price", () => {
    const item = {
      kind: "GIFT",
      id,
      version: 1,
      sourceLocale: "en",
      name: "Gift",
      description: "",
      image: null,
      status: "paused",
      handle: "gift",
      giftKind: "OTHER",
      category: "OTHER",
      price: { market: "TEST_B", currency: "EUR", amountMinor: 2200 },
      inventory: null,
      eligibility: { rule: "EXPLICIT_ARTISTS" },
      canEdit: false,
      inventoryPolicyLocked: false,
    };
    const response = {
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "LIST",
      section: "GIFTS",
      page: 1,
      pageSize: 12,
      totalItems: 1,
      items: [item],
    };
    const priceScope = { market: "TEST_A", currency: "USD" };
    const sortPrice = { ...priceScope, amountMinor: 1500 };
    const acceptsResponse = (value: unknown) =>
      managementCenterResponseSchema.safeParse(value).success;
    expect(acceptsResponse(response)).toBe(true);
    // Omitted JSON properties are valid; an explicit undefined is not a DTO value.
    expect(acceptsResponse({ ...response, priceScope: undefined })).toBe(false);
    expect(
      acceptsResponse({
        ...response,
        items: [{ ...item, sortPrice: undefined }],
      }),
    ).toBe(false);
    for (const price of [sortPrice, null])
      expect(
        acceptsResponse({
          ...response,
          priceScope,
          items: [{ ...item, sortPrice: price }],
        }),
      ).toBe(true);
    expect(acceptsResponse({ ...response, priceScope })).toBe(false);
    expect(
      acceptsResponse({ ...response, items: [{ ...item, sortPrice }] }),
    ).toBe(false);
    expect(
      acceptsResponse({
        ...response,
        priceScope,
        items: [{ ...item, sortPrice: item.price }],
      }),
    ).toBe(false);
    expect(
      acceptsResponse({
        ...response,
        section: "ARTISTS",
        totalItems: 0,
        items: [],
        priceScope,
      }),
    ).toBe(false);
  });
});
describe("management center boundary", () => {
  it("requires a single artist and one tracked unit for new wish submissions without rewriting legacy intents", () => {
    const legacy = { ...gift, giftKind: "WISH" };
    expect(managementCenterIntentSchema.parse(legacy)).toEqual(legacy);
    const submit = (intent: unknown) =>
      managementCenterCommandSchema.safeParse({
        schemaVersion: 1,
        action: "SUBMIT",
        intent,
        idempotencyKey: "wish-create-0000001",
      }).success;
    const wish = {
      ...legacy,
      eligibility: { rule: "SINGLE_ARTIST", idolId: id },
      inventory: { policy: "TRACKED", locationId: id, quantity: 1 },
    };
    expect(submit(wish)).toBe(true);
    expect(submit(legacy)).toBe(false);
    for (const invalid of [
      { ...wish, giftKind: "PHYSICAL" },
      { ...wish, eligibility: { rule: "SINGLE_ARTIST" } },
      { ...wish, inventory: { policy: "PROCURE_ON_DEMAND" } },
      {
        ...wish,
        inventory: { policy: "TRACKED", locationId: id, quantity: 2 },
      },
    ])
      expect(submit(invalid)).toBe(false);
    expect(managementCenterIntentSchema.parse(gift)).toEqual(gift);
  });
  it("exposes an explicit inventory policy lock without disabling gift editing", () => {
    const item = {
      kind: "GIFT",
      id,
      version: 2,
      sourceLocale: "th",
      name: "Gift",
      description: "Description",
      image: null,
      status: "active",
      handle: "gift",
      giftKind: "VIRTUAL",
      category: "OTHER",
      price: { market: "TEST", currency: "USD", amountMinor: 1000 },
      inventory: { policy: "TRACKED", locationId: id, quantity: 0 },
      eligibility: { rule: "ALL_ACTIVE_ARTISTS" },
      canEdit: true,
      inventoryPolicyLocked: true,
    };
    expect(managementCenterListItemSchema.safeParse(item).success).toBe(true);
    expect(
      managementCenterResponseSchema.safeParse({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "INVENTORY_POLICY_LOCKED",
      }).success,
    ).toBe(true);
    const missing: Record<string, unknown> = { ...item };
    delete missing["inventoryPolicyLocked"];
    expect(managementCenterListItemSchema.safeParse(missing).success).toBe(
      false,
    );
  });
  it("accepts actual source language without inventing English or reviews", () => {
    expect(managementCenterIntentSchema.parse(artist)).toEqual(artist);
    expect(
      managementCenterIntentSchema.safeParse({ ...artist, translations: [] })
        .success,
    ).toBe(false);
  });
  it.each([
    { ...artist, image: null },
    { ...artist, expectedVersion: 1 },
    { ...artist, id, expectedVersion: 0 },
    { ...artist, name: " " },
    { ...artist, image: { url: "https://example.test/private" } },
  ])("rejects incomplete or contradictory artist input", (input) => {
    expect(managementCenterIntentSchema.safeParse(input).success).toBe(false);
  });
  it("allows editing to keep the current image at an exact version", () => {
    expect(
      managementCenterIntentSchema.safeParse({
        ...artist,
        id,
        expectedVersion: 2,
        image: null,
      }).success,
    ).toBe(true);
  });
  it("keeps gift kind independent of inventory policy", () => {
    expect(managementCenterIntentSchema.safeParse(gift).success).toBe(true);
    expect(
      managementCenterIntentSchema.safeParse({
        ...gift,
        inventory: { policy: "TRACKED", quantity: 0, locationId: id },
      }).success,
    ).toBe(true);
    expect(
      managementCenterIntentSchema.safeParse({
        ...gift,
        inventory: { policy: "PREORDER" },
      }).success,
    ).toBe(true);
    expect(
      managementCenterIntentSchema.safeParse({
        ...gift,
        inventory: { policy: "PROCURE_ON_DEMAND", quantity: 5 },
      }).success,
    ).toBe(false);
  });
  it("requires exact price and configured tracking location", () => {
    expect(
      managementCenterIntentSchema.safeParse({
        ...gift,
        price: { ...gift.price, amountMinor: 1.5 },
      }).success,
    ).toBe(false);
    expect(
      managementCenterIntentSchema.safeParse({
        ...gift,
        inventory: { policy: "TRACKED", quantity: 1 },
      }).success,
    ).toBe(false);
  });
  it("offers only the four scoped intents", () => {
    expect(
      managementCenterIntentSchema.safeParse({
        kind: "SAVE_POLICY",
        sourceLocale: "en",
      }).success,
    ).toBe(false);
    expect(
      managementCenterIntentSchema.safeParse({
        kind: "RESTORE_POSTER",
        sourceLocale: "en",
        expectedVersion: 1,
        sourceRevisionId: id,
      }).success,
    ).toBe(true);
  });
  it("retains real content field limits instead of silently truncating", () => {
    expect(
      managementCenterIntentSchema.safeParse({
        ...artist,
        name: "x".repeat(41),
      }).success,
    ).toBe(false);
    expect(
      managementCenterIntentSchema.safeParse({ ...gift, name: "x".repeat(101) })
        .success,
    ).toBe(false);
    expect(
      managementCenterIntentSchema.safeParse({
        ...artist,
        description: "x".repeat(601),
      }).success,
    ).toBe(false);
  });
  it("requires explicit rights confirmation and forbids credentials in commands", () => {
    const command = {
      schemaVersion: 1,
      action: "PREPARE_UPLOAD",
      checksumSha256: "a".repeat(64),
      byteSize: 1000,
      mimeType: "image/jpeg",
      rightsConfirmed: true,
      idempotencyKey: "management-upload-01",
    };
    expect(managementCenterCommandSchema.safeParse(command).success).toBe(true);
    expect(
      managementCenterCommandSchema.safeParse({
        ...command,
        rightsConfirmed: false,
      }).success,
    ).toBe(false);
    expect(
      managementCenterCommandSchema.safeParse({ ...command, sessionToken: "x" })
        .success,
    ).toBe(false);
  });
  it("does not accept a false published result or expose worker data", () => {
    const operation = {
      operationId: id,
      version: 1,
      kind: "SAVE_ARTIST",
      sourceLocale: "th",
      status: "PROCESSING",
      targetId: null,
      updatedAt: "2026-09-08T00:00:00Z",
      result: null,
      failure: null,
    };
    expect(managementCenterOperationSchema.safeParse(operation).success).toBe(
      true,
    );
    expect(
      managementCenterOperationSchema.safeParse({
        ...operation,
        status: "PUBLISHED",
      }).success,
    ).toBe(false);
    expect(
      managementCenterOperationSchema.safeParse({
        ...operation,
        leaseToken: "secret",
      }).success,
    ).toBe(false);
    expect(
      managementCenterOperationSchema.safeParse({
        ...operation,
        status: "FAILED",
        failure: { code: "MEDIA_FAILED", retryable: true },
      }).success,
    ).toBe(true);
    expect(
      managementCenterResponseSchema.safeParse({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "OPERATION",
        operation,
      }).success,
    ).toBe(true);
  });
  it("retains unavailable poster history without claiming it can be restored", () => {
    const item = {
      kind: "POSTER",
      id,
      version: 1,
      sourceLocale: "en",
      sourceRevisionId: id,
      current: false,
      image: null,
      canRestore: false,
      canDelete: true,
      createdAt: "2026-09-08T00:00:00Z",
    };
    const response = {
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "LIST",
      section: "POSTERS",
      page: 1,
      pageSize: 10,
      totalItems: 1,
      items: [item],
    };
    expect(managementCenterResponseSchema.safeParse(response).success).toBe(
      true,
    );
    expect(
      managementCenterResponseSchema.safeParse({
        ...response,
        items: [{ ...item, canRestore: true }],
      }).success,
    ).toBe(false);
    // The poster on the homepage can never be offered for deletion.
    expect(
      managementCenterResponseSchema.safeParse({
        ...response,
        items: [{ ...item, current: true, canDelete: true }],
      }).success,
    ).toBe(false);
    expect(
      managementCenterResponseSchema.safeParse({
        ...response,
        items: [{ ...item, current: true, canDelete: false }],
      }).success,
    ).toBe(true);
  });
});

// ADR-022 / L3-11: brokers and artist assignment.
describe("artist assignment boundary", () => {
  const brokerId = "00000000-0000-4000-8000-000000000002";
  const broker = { brokerId, displayName: "Mina Park", active: true };
  const listed = {
    kind: "ARTIST",
    id,
    version: 2,
    sourceLocale: "th",
    name: "Artist",
    description: "Description",
    image: null,
    status: "active",
    handle: "artist",
  };
  const context = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "CONTEXT",
    capability: "DIRECT_OPERATOR_V1",
    markets: [],
    defaults: null,
    giftKinds: ["VIRTUAL"],
    categories: ["OTHER"],
    poster: { available: false, version: 0, currentRevisionId: null },
    operations: [],
  };
  it("filters the artist list by assignment and never another section", () => {
    const list = {
      schemaVersion: 1,
      action: "LIST",
      section: "ARTISTS",
      page: 1,
      pageSize: 12,
    };
    const accepts = (value: unknown) =>
      managementCenterCommandSchema.safeParse(value).success;
    expect(accepts(list)).toBe(true);
    expect(accepts({ ...list, assignment: { kind: "UNASSIGNED" } })).toBe(true);
    expect(accepts({ ...list, assignment: { kind: "BROKER", brokerId } })).toBe(
      true,
    );
    expect(accepts({ ...list, assignment: { kind: "BROKER" } })).toBe(false);
    expect(accepts({ ...list, assignment: { kind: "ALL" } })).toBe(false);
    expect(
      accepts({
        ...list,
        section: "GIFTS",
        assignment: { kind: "UNASSIGNED" },
      }),
    ).toBe(false);
  });
  it("lists every artist with its broker or as unassigned", () => {
    const accepts = (value: unknown) =>
      managementCenterListItemSchema.safeParse(value).success;
    expect(accepts(listed)).toBe(false);
    expect(accepts({ ...listed, assignment: null })).toBe(true);
    expect(accepts({ ...listed, assignment: broker })).toBe(true);
    expect(
      accepts({ ...listed, assignment: { ...broker, active: false } }),
    ).toBe(true);
    // Neither a login name nor any contact detail travels with the assignment.
    expect(
      accepts({ ...listed, assignment: { ...broker, loginName: "mina" } }),
    ).toBe(false);
  });
  it("tells the center whose artists the account manages", () => {
    const accepts = (artists: unknown) =>
      managementCenterResponseSchema.safeParse({ ...context, artists }).success;
    expect(managementCenterResponseSchema.safeParse(context).success).toBe(
      false,
    );
    expect(accepts({ scope: "ALL", canAssign: true, brokers: [broker] })).toBe(
      true,
    );
    expect(accepts({ scope: "ALL", canAssign: false, brokers: [broker] })).toBe(
      true,
    );
    expect(accepts({ scope: "ASSIGNED", canAssign: false, brokers: [] })).toBe(
      true,
    );
    // A broker never assigns and never receives the directory of other brokers.
    expect(accepts({ scope: "ASSIGNED", canAssign: true, brokers: [] })).toBe(
      false,
    );
    expect(
      accepts({ scope: "ASSIGNED", canAssign: false, brokers: [broker] }),
    ).toBe(false);
  });
  it("assigns an artist to a broker or back to unassigned", () => {
    const command = {
      schemaVersion: 1,
      action: "ASSIGN_ARTIST",
      artistId: id,
      brokerId,
      expectedBrokerId: null,
      idempotencyKey: "management-assign-01",
    };
    const accepts = (value: unknown) =>
      managementCenterCommandSchema.safeParse(value).success;
    expect(accepts(command)).toBe(true);
    expect(
      accepts({ ...command, brokerId: null, expectedBrokerId: brokerId }),
    ).toBe(true);
    const missing: Record<string, unknown> = { ...command };
    delete missing["expectedBrokerId"];
    expect(accepts(missing)).toBe(false);
    expect(accepts({ ...command, actorId: id })).toBe(false);
    const response = {
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "ARTIST_ASSIGNED",
      artistId: id,
    };
    expect(
      managementCenterResponseSchema.safeParse({
        ...response,
        assignment: broker,
      }).success,
    ).toBe(true);
    expect(
      managementCenterResponseSchema.safeParse({
        ...response,
        assignment: null,
      }).success,
    ).toBe(true);
    expect(managementCenterResponseSchema.safeParse(response).success).toBe(
      false,
    );
  });
});
