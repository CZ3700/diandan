import { describe, expect, test } from "vitest";
import {
  catalogDirectoryOfferSchema,
  idolDirectoryResponseSchema,
  giftDirectoryResponseSchema,
  idolDirectoryCursorSchema,
  idolDirectoryReadCommandSchema,
} from "./index.js";
const hash = "a".repeat(64);
describe("catalog directory boundaries", () => {
  test("rejects a selectable gift without a canonical price, unsafe amounts and leaked price fields", () => {
    const offer = {
      schemaVersion: 1,
      market: "GLOBAL",
      currency: "USD",
      priceMinor: 1200,
      purchasable: true,
    };
    expect(catalogDirectoryOfferSchema.safeParse(offer).success).toBe(true);
    for (const changes of [
      { priceMinor: null },
      { purchasable: false },
      { priceMinor: -1 },
      { priceMinor: 0.5 },
      { priceMinor: Number.MAX_SAFE_INTEGER + 1 },
      { priceBookId: "private" },
    ]) {
      expect(
        catalogDirectoryOfferSchema.safeParse({ ...offer, ...changes }).success,
      ).toBe(false);
    }
    expect(
      catalogDirectoryOfferSchema.safeParse({
        ...offer,
        priceMinor: null,
        purchasable: false,
      }).success,
    ).toBe(true);
  });
  test("keeps cursor and next-window availability consistent and response data public", () => {
    const empty = {
      schemaVersion: 1,
      outcome: "SUCCESS",
      catalogVersion: hash,
      items: [],
      pageInfo: { schemaVersion: 1, hasNextPage: false, endCursor: null },
    };
    expect(idolDirectoryResponseSchema.safeParse(empty).success).toBe(true);
    for (const value of [
      { ...empty, selection: {} },
      { ...empty, schemaVersion: 2 },
      { ...empty, pageInfo: { ...empty.pageInfo, hasNextPage: true } },
    ])
      expect(idolDirectoryResponseSchema.safeParse(value).success).toBe(false);
    for (const schema of [
      idolDirectoryResponseSchema,
      giftDirectoryResponseSchema,
    ]) {
      expect(
        schema.safeParse({
          schemaVersion: 1,
          outcome: "FAILURE",
          code: "CATALOG_UNAVAILABLE",
        }).success,
      ).toBe(true);
      expect(
        schema.safeParse({
          schemaVersion: 1,
          outcome: "FAILURE",
          code: "CATALOG_UNAVAILABLE",
          message: "database internals",
        }).success,
      ).toBe(false);
    }
  });
  test("rejects cursor authority fields, unknown versions and missing read envelopes", () => {
    const cursor = {
      schemaVersion: 1,
      queryHash: hash,
      catalogVersion: hash,
      afterId: "10000000-0000-4000-8000-000000000001",
    };
    expect(idolDirectoryCursorSchema.safeParse(cursor).success).toBe(true);
    for (const value of [
      { ...cursor, schemaVersion: 2 },
      { ...cursor, catalogVersion: "untrusted" },
      { ...cursor, permission: "admin" },
    ])
      expect(idolDirectoryCursorSchema.safeParse(value).success).toBe(false);
    expect(idolDirectoryReadCommandSchema.safeParse({}).success).toBe(false);
  });
});
