import { expect, it } from "vitest";
const load = () => import("./checkout-preflight-public.js").catch(() => null);
const id = "10000000-0000-4000-8000-000000000001";
const localeContext = {
  schemaVersion: 1,
  requestedLocale: "en",
  resolvedLocale: "en",
  fallbackUsed: false,
  translationRevision: id,
};
const line = {
  schemaVersion: 1,
  cartItemId: id,
  idolDisplayName: "🎁".repeat(40),
  giftTitle: "Gift",
  giftVariantLabel: "One",
  idolLocaleContext: localeContext,
  giftLocaleContext: localeContext,
  quantity: 2,
  unitAmountMinor: 50,
  lineSubtotalMinor: 100,
  taxAmountMinor: 0,
  discountAmountMinor: 0,
  lineTotalMinor: 100,
};
it("exposes codepoint-safe public lines but no private or storage references", async () => {
  const schemas = await load();
  expect(
    schemas?.checkoutPreflightPublicLineSchema.safeParse(line).success,
  ).toBe(true);
  for (const changes of [
    { supportIntentId: id },
    { objectKey: "original/photo.webp" },
    { fanMessage: "not public" },
    { idolDisplayName: "🎁".repeat(41) },
    { quantity: 2147483648 },
    { lineTotalMinor: 99 },
  ])
    expect(
      schemas?.checkoutPreflightPublicLineSchema.safeParse({
        ...line,
        ...changes,
      }).success,
    ).toBe(false);
});
it("accepts typed failure on the shared response union", async () => {
  const schemas = await load();
  expect(
    schemas?.checkoutPreflightResponseSchema.safeParse({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "VERSION_CONFLICT",
    }).success,
  ).toBe(true);
});
