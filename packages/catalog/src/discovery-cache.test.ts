import { expect, test } from "vitest";

import { createDiscoveryCacheKey as keyFor } from "./index.js";

test("cache identity includes locale, commerce, filters and publication version without exposing the search term", () => {
  const query = {
    schemaVersion: 1,
    locale: "en",
    market: "TEST",
    currency: "USD",
  };
  const input = {
    schemaVersion: 1,
    kind: "GIFTS",
    catalogVersion: "a".repeat(64),
    query,
  };
  const initial = keyFor(input);
  expect(
    keyFor({
      ...input,
      query: {
        ...query,
        page: 1,
        pageSize: 12,
        sort: "RECOMMENDED",
        availability: "ALL",
      },
    }),
  ).toEqual(initial);
  for (const change of [
    { locale: "th" },
    { currency: "EUR" },
    { market: "SECOND" },
    { page: 2 },
    { sort: "PRICE_DESC" },
    { category: "FLOWERS" },
    { priceMinMinor: 0 },
    { availability: "PURCHASABLE" },
  ])
    expect(keyFor({ ...input, query: { ...query, ...change } })).not.toEqual(
      initial,
    );
  expect(keyFor({ ...input, catalogVersion: "b".repeat(64) })).not.toEqual(
    initial,
  );
  const idol = {
    schemaVersion: 1,
    kind: "IDOLS",
    catalogVersion: input.catalogVersion,
    query: { schemaVersion: 1, locale: "vi", q: "Mỹ ＡＮＨ" },
  };
  const artistKey = keyFor(idol);
  expect(keyFor({ ...idol, query: { ...idol.query, q: "mỹ anh" } })).toEqual(
    artistKey,
  );
  expect(artistKey.key).toMatch(/^catalog:v1:[a-f0-9]{64}$/u);
  expect(artistKey.key).not.toContain("anh");
  expect(() => keyFor({ ...input, catalogVersion: "unversioned" })).toThrow();
});
