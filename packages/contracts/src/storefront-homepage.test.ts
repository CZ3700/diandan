import * as homepageModule from "./storefront-homepage.js";
import { expect, test } from "vitest";
import { SUPPORTED_LOCALES } from "./locale.js";

async function schemas() {
  return homepageModule;
}

test("homepage composition only accepts explicit supported locale", async () => {
  const { storefrontHomepageReadCommandSchema: schema } = await schemas();
  for (const locale of SUPPORTED_LOCALES)
    expect(schema.safeParse({ schemaVersion: 1, locale }).success).toBe(true);
  for (const value of [
    { schemaVersion: 1, locale: "en", giftIds: [] },
    { schemaVersion: 1, locale: "en", revisionId: "caller" },
    { schemaVersion: 1, locale: "en", market: "test" },
    { schemaVersion: 1, locale: "en-XA" },
    { schemaVersion: 2, locale: "en" },
    { schemaVersion: 1 },
  ])
    expect(schema.safeParse(value).success).toBe(false);
});

test("safe failures never carry database or private content fields", async () => {
  const { storefrontHomepageResponseSchema: schema } = await schemas();
  const failure = {
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CONTENT_UNAVAILABLE",
  };
  expect(schema.parse(failure)).toEqual(failure);
  expect(schema.safeParse({ ...failure, manifest: {} }).success).toBe(false);
});
