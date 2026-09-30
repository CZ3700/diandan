import { expect, test } from "vitest";
import type { z } from "zod";
import { cartRuntimeAddCommandSchema } from "./cart-runtime.js";
import { cartEditPersonalizationSchema } from "./cart-edit.js";

const modulePath = "./wish-gallery.js";
const schemas = (await import(modulePath).catch(() => ({}))) as Record<
  string,
  z.ZodType
>;
const schema = (name: string) => {
  expect(schemas[name], `${name} must exist`).toBeDefined();
  return schemas[name]!;
};
const id = "00000000-0000-4000-8000-000000000001";
const add = {
  schemaVersion: 1,
  operation: "ADD_CART_ITEM",
  presentationLocale: "en",
  market: "TEST",
  currency: "USD",
  idolId: id,
  giftId: id,
  giftVariantId: id,
  observedPriceId: id,
  quantity: 1,
  displayMode: "nickname",
  displayName: "Private name",
  fanMessageLocale: "und",
};

test("a public wish alias is independent from private personalization", () => {
  const galleryPreference = {
    visibility: "PUBLIC_NAMED",
    publicAlias: "Moon friend",
  };
  expect(
    cartRuntimeAddCommandSchema.safeParse({ ...add, galleryPreference })
      .success,
  ).toBe(true);
  expect(
    cartEditPersonalizationSchema.safeParse({
      kind: "PERSONALIZATION",
      displayMode: "anonymous",
      fanMessageLocale: "und",
      galleryPreference,
    }).success,
  ).toBe(true);
  expect(cartRuntimeAddCommandSchema.parse(add)).toEqual(add);
});

test("publicity is explicit and an alias belongs only to named publicity", () => {
  const preference = schema("wishGalleryPreferenceSchema");
  for (const visibility of ["PRIVATE", "PUBLIC_ANONYMOUS"])
    expect(preference.parse({ visibility })).toEqual({ visibility });
  expect(
    preference.safeParse({
      visibility: "PUBLIC_NAMED",
      publicAlias: "🙂".repeat(40),
    }).success,
  ).toBe(true);
  for (const value of [
    undefined,
    {},
    { visibility: "PUBLIC_NAMED" },
    { visibility: "PRIVATE", publicAlias: "name" },
    { visibility: "PUBLIC_ANONYMOUS", publicAlias: "name" },
  ])
    expect(preference.safeParse(value).success).toBe(false);
  for (const publicAlias of [
    "",
    " ",
    " name ",
    "a\nname",
    "\u202Ename",
    "\ud800",
    "🙂".repeat(41),
  ])
    expect(
      preference.safeParse({ visibility: "PUBLIC_NAMED", publicAlias }).success,
    ).toBe(false);
});

test("public entries are allowlisted and reveal no order or private data", () => {
  const entry = {
    entryId: id,
    idol: {
      handle: "idol",
      displayName: "Artist",
      locale: "en",
      portrait: {
        url: "https://cdn.example.test/portrait.webp",
        alt: "Artist",
        locale: "ja",
      },
    },
    gift: {
      title: "A wish",
      locale: "zh-CN",
      image: {
        url: "https://cdn.example.test/gift.webp",
        alt: "Gift",
        locale: "th",
      },
    },
    supportedAt: "2026-10-01T00:00:00.000Z",
    supporter: { kind: "ANONYMOUS" },
  };
  const publicEntry = schema("wishGalleryEntrySchema");
  expect(publicEntry.parse(entry)).toEqual(entry);
  for (const field of [
    "orderId",
    "publicOrderId",
    "displayName",
    "fanMessage",
    "amountMinor",
    "email",
    "supportIntentId",
  ])
    expect(publicEntry.safeParse({ ...entry, [field]: "secret" }).success).toBe(
      false,
    );
  expect(
    publicEntry.safeParse({
      ...entry,
      supporter: { kind: "ANONYMOUS", alias: "name" },
    }).success,
  ).toBe(false);
});

test("gallery reads have bounded pages and withdrawal requires order credentials", () => {
  const read = schema("wishGalleryReadCommandSchema");
  expect(read.parse({ schemaVersion: 1, locale: "en" })).toEqual({
    schemaVersion: 1,
    locale: "en",
  });
  expect(
    read.safeParse({ schemaVersion: 1, locale: "th", idolId: id, limit: 50 })
      .success,
  ).toBe(true);
  for (const limit of [0, 51, 1.5])
    expect(
      read.safeParse({ schemaVersion: 1, locale: "en", limit }).success,
    ).toBe(false);
  const withdraw = schema("wishGalleryWithdrawCommandSchema");
  const command = {
    schemaVersion: 1,
    publicOrderId: id,
    entryId: id,
    requestId: id,
    correlationId: id,
    taskName: "wish-gallery",
    sessionCandidates: [
      { schemaVersion: 1, tokenDigest: "a".repeat(64), pepperVersion: "v1" },
    ],
  };
  expect(withdraw.safeParse(command).success).toBe(true);
  expect(
    withdraw.safeParse({ ...command, sessionCandidates: [] }).success,
  ).toBe(false);
  expect(
    withdraw.safeParse({ ...command, sessionCandidates: undefined }).success,
  ).toBe(false);
});
test("withdrawal can retain the existing order-session rate-limit failure", () => {
  expect(
    schema("wishGalleryWithdrawResponseSchema").safeParse({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "RATE_LIMITED",
    }).success,
  ).toBe(true);
});
