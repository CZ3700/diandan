import { describe, expect, test } from "vitest";
import { orderAccessItemSchema } from "./order-access.js";

// ADR-019 supplement (L3-09): each delivered virtual line carries its savable certificate facts.
describe("support certificate facts on fan order lines", () => {
  const language = {
    schemaVersion: 1,
    mode: "APPROVED",
    requestedLocale: "en",
    resolvedLocale: "en",
    fallbackUsed: false,
  };
  const media = {
    url: "https://media.example.test/artist.webp",
    alt: "Artist",
    locale: language,
  };
  const item = {
    schemaVersion: 1,
    position: 1,
    idol: {
      handle: "test-artist",
      displayName: "Artist",
      locale: language,
      portrait: media,
    },
    gift: {
      title: "Cheer",
      variantLabel: null,
      locale: language,
      image: media,
    },
    quantity: 2,
    unitAmountMinor: 500,
    lineSubtotalMinor: 1000,
    taxAmountMinor: 0,
    discountAmountMinor: 0,
    lineTotalMinor: 1000,
    currency: "USD",
    displayMode: "nickname",
    giftKind: "VIRTUAL",
    fulfillmentStatus: "DELIVERED",
    deliveryProofs: [],
    supportCertificate: {
      deliveredAt: "2026-09-29T12:00:00.000Z",
      revoked: false,
    },
  };
  const parse = (change: Record<string, unknown>) =>
    orderAccessItemSchema.safeParse({ ...item, ...change }).success;

  test("a delivered virtual line carries its certificate, live or revoked", () => {
    expect(parse({})).toBe(true);
    expect(
      parse({
        supportCertificate: { ...item.supportCertificate, revoked: true },
      }),
    ).toBe(true);
  });

  test("every other line has none, and a delivered virtual line cannot omit it", () => {
    expect(parse({ supportCertificate: null })).toBe(false);
    for (const change of [
      { giftKind: "PHYSICAL" },
      { giftKind: "WISH" },
      { giftKind: null },
      { fulfillmentStatus: "PENDING" },
      { fulfillmentStatus: "ON_HOLD" },
      { fulfillmentStatus: "CANCELED" },
    ]) {
      expect(parse(change)).toBe(false);
      expect(parse({ ...change, supportCertificate: null })).toBe(true);
    }
    const legacy = Object.fromEntries(
      Object.entries(item).filter(([key]) => key !== "supportCertificate"),
    );
    expect(orderAccessItemSchema.safeParse(legacy).success).toBe(false);
  });

  test("the certificate holds no message, name, amount or contact", () => {
    for (const extra of [
      { fanMessage: "hi" },
      { displayName: "Fan" },
      { amountMinor: 1000 },
      { email: "fan@example.test" },
    ])
      expect(
        parse({ supportCertificate: { ...item.supportCertificate, ...extra } }),
      ).toBe(false);
    expect(
      parse({
        supportCertificate: {
          ...item.supportCertificate,
          deliveredAt: "yesterday",
        },
      }),
    ).toBe(false);
  });
});
