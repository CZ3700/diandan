import { expect, test } from "vitest";
import {
  giftBrowseQuerySchema,
  giftBrowseResponseSchema,
} from "./gift-browse.js";
import {
  giftBrowseReadCommandSchema,
  giftBrowseSnapshotSchema,
} from "./gift-browse-internal.js";
import { runtimeDependencies } from "../test-support/module-boundary.js";

const query = { schemaVersion: 1, locale: "th" };
const empty = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  catalogVersion: "a".repeat(64),
  items: [],
  pageInfo: {
    schemaVersion: 1,
    page: 1,
    pageSize: 12,
    totalItems: 0,
    totalPages: 0,
    hasPreviousPage: false,
    hasNextPage: false,
    paginationLimited: false,
  },
};

test("browses published content without selecting a market or inventing an offer", () => {
  expect(giftBrowseQuerySchema.parse(query)).toEqual({
    ...query,
    page: 1,
    pageSize: 12,
  });
  expect(giftBrowseResponseSchema.safeParse(empty).success).toBe(true);
  for (const extra of [
    { market: "TEST" },
    { currency: "USD" },
    { sort: "PRICE_ASC" },
    { priceMinMinor: 0 },
    { availability: "ALL" },
    { page: 1001 },
    { pageSize: 49 },
  ])
    expect(
      giftBrowseQuerySchema.safeParse({ ...query, ...extra }).success,
    ).toBe(false);
  for (const extra of [{ offer: null }, { market: "TEST" }, { selection: {} }])
    expect(
      giftBrowseResponseSchema.safeParse({ ...empty, ...extra }).success,
    ).toBe(false);
});

test("keeps discovery envelopes bounded, versioned and separate from publication evidence", () => {
  expect(
    giftBrowseReadCommandSchema.safeParse({ schemaVersion: 1, query }).success,
  ).toBe(true);
  expect(
    giftBrowseSnapshotSchema.safeParse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      catalogVersion: "a".repeat(64),
      totalItems: 0,
      items: [],
    }).success,
  ).toBe(true);
  expect(
    giftBrowseReadCommandSchema.safeParse({ schemaVersion: 2, query }).success,
  ).toBe(false);
  expect(
    giftBrowseResponseSchema.safeParse({
      ...empty,
      pageInfo: { ...empty.pageInfo, totalItems: 1, totalPages: 1 },
    }).success,
  ).toBe(false);
  for (const forbidden of [
    "public-projection.ts",
    "publication.ts",
    "daily-publication.ts",
  ])
    expect(runtimeDependencies("gift-browse.ts")).not.toContain(forbidden);
});
