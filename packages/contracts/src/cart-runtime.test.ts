import { expect, test } from "vitest";
import { z } from "zod";

const modulePath = "./cart-runtime.js";
const runtime = (await import(modulePath).catch(() => ({}))) as Record<
  string,
  z.ZodType
>;
const schema = (name: string) => {
  expect(runtime[name], `${name} must exist`).toBeDefined();
  return runtime[name]!;
};
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const add = {
  schemaVersion: 1,
  operation: "ADD_CART_ITEM",
  presentationLocale: "en",
  market: "TEST",
  currency: "USD",
  idolId: id(1),
  giftId: id(2),
  giftVariantId: id(3),
  observedPriceId: id(4),
  quantity: 1,
  displayMode: "anonymous",
  fanMessageLocale: "und",
};

test("three cart commands are strict and never receive access tokens or prices", () => {
  const command = schema("cartRuntimeCommandSchema");
  expect(command.safeParse(add).success).toBe(true);
  expect(
    command.safeParse({
      schemaVersion: 1,
      operation: "INITIALIZE_CART",
      presentationLocale: "ja",
      market: "TEST",
      currency: "USD",
    }).success,
  ).toBe(true);
  expect(
    command.safeParse({
      schemaVersion: 1,
      operation: "READ_CART",
      presentationLocale: "th",
    }).success,
  ).toBe(true);
  for (const extra of [
    { token: "secret" },
    { unitAmountMinor: 1 },
    { cartId: id(5) },
    { sourceLocale: "en" },
  ])
    expect(command.safeParse({ ...add, ...extra }).success).toBe(false);
  expect(command.safeParse({ ...add, schemaVersion: 2 }).success).toBe(false);
});

test("private text counts Unicode codepoints and preserves the exact supplied text", () => {
  const command = schema("cartRuntimeAddCommandSchema");
  const text = "🙂".repeat(280);
  expect(command.parse({ ...add, fanMessage: text })).toMatchObject({
    fanMessage: text,
  });
  expect(command.safeParse({ ...add, fanMessage: text + "a" }).success).toBe(
    false,
  );
  expect(
    command.safeParse({
      ...add,
      displayMode: "nickname",
      displayName: "🙂".repeat(40),
    }).success,
  ).toBe(true);
  expect(
    command.safeParse({
      ...add,
      displayMode: "nickname",
      displayName: "🙂".repeat(41),
    }).success,
  ).toBe(false);
  for (const fanMessage of ["", "\ud800", "\udc00", "a\ud800b"])
    expect(command.safeParse({ ...add, fanMessage }).success).toBe(false);
  expect(command.safeParse({ ...add, displayName: "name" }).success).toBe(
    false,
  );
  expect(command.safeParse({ ...add, displayMode: "nickname" }).success).toBe(
    false,
  );
});

test("generated JSON Schema publishes Unicode character limits rather than UTF-16 implementation bounds", () => {
  const json = z.toJSONSchema(schema("cartRuntimeAddCommandSchema"));
  const branches = json["oneOf"] as Array<{
    properties: Record<string, { minLength?: number; maxLength?: number }>;
  }>;
  expect(branches[0]?.properties["fanMessage"]).toMatchObject({
    minLength: 1,
    maxLength: 280,
  });
  expect(branches[1]?.properties["displayName"]).toMatchObject({
    minLength: 1,
    maxLength: 40,
  });
});

test("quantity respects positive PostgreSQL integer bounds without coercion", () => {
  const command = schema("cartRuntimeAddCommandSchema");
  expect(command.safeParse({ ...add, quantity: 2_147_483_647 }).success).toBe(
    true,
  );
  for (const quantity of [0, -1, 1.5, 2_147_483_648, "2", Number.NaN])
    expect(command.safeParse({ ...add, quantity }).success).toBe(false);
});

test("cart authority records require the actual PostgreSQL expiry result", () => {
  const header = {
    schemaVersion: 1,
    id: id(5),
    version: 1,
    status: "ACTIVE",
    presentationLocale: "en",
    market: "TEST",
    currency: "USD",
    expiresAt: "2026-09-09T00:00:00Z",
    createdAt: "2026-09-08T00:00:00Z",
    updatedAt: "2026-09-08T00:00:00Z",
  };
  expect(schema("cartRuntimeHeaderSchema").safeParse(header).success).toBe(
    false,
  );
  expect(
    schema("cartRuntimeHeaderSchema").safeParse({ ...header, expired: false })
      .success,
  ).toBe(true);
  expect(
    schema("cartRuntimeHeaderSchema").safeParse({ ...header, expired: true })
      .success,
  ).toBe(true);
});

test("private persistence content always carries a real wrapped key even with no private fields", () => {
  const content = schema("cartRuntimePrivateContentSchema");
  const wrapped = {
    fanMessageCiphertext: null,
    displayNameCiphertext: null,
    encryptedDataKey: "enc:v1:" + "A".repeat(40),
    encryptionKeyVersion: "test-key-v1",
  };
  expect(content.safeParse(wrapped).success).toBe(true);
  expect(
    content.safeParse({ ...wrapped, encryptedDataKey: null }).success,
  ).toBe(false);
  expect(
    content.safeParse({ ...wrapped, fanMessage: "not persisted" }).success,
  ).toBe(false);
});

test("pepper candidates and persistence commands reject ambiguous or private input", () => {
  const access = {
    schemaVersion: 1,
    tokenDigest: "a".repeat(64),
    pepperVersion: "test-v1",
  };
  const accesses = schema("cartRuntimeAccessesSchema");
  expect(accesses.safeParse([access]).success).toBe(true);
  expect(accesses.safeParse([]).success).toBe(false);
  expect(accesses.safeParse([access, access]).success).toBe(false);
  expect(
    accesses.safeParse(
      Array.from({ length: 5 }, (_, index) => ({
        ...access,
        pepperVersion: `v${index}`,
      })),
    ).success,
  ).toBe(false);
  expect(accesses.safeParse([{ ...access, token: "raw" }]).success).toBe(false);
  const append = {
    schemaVersion: 1,
    accesses: [access],
    cartId: id(5),
    expectedCartVersion: 1,
    cartItemId: id(6),
    supportIntentId: id(7),
    giftVariantId: id(3),
    idolId: id(1),
    quantity: 1,
    observedPriceId: id(4),
    createdPresentationLocale: "en",
    fanMessageLocale: "und",
    displayMode: "anonymous",
    privateContent: {
      fanMessageCiphertext: null,
      displayNameCiphertext: null,
      encryptedDataKey: "enc:v1:" + "A".repeat(40),
      encryptionKeyVersion: "test-v1",
    },
    requestId: id(8),
    correlationId: id(9),
  };
  const command = schema("cartRuntimeAppendItemCommandSchema");
  expect(command.safeParse(append).success).toBe(true);
  expect(
    command.safeParse({ ...append, displayMode: "nickname" }).success,
  ).toBe(false);
  expect(
    command.safeParse({
      ...append,
      privateContent: {
        ...append.privateContent,
        displayNameCiphertext: append.privateContent.encryptedDataKey,
      },
    }).success,
  ).toBe(false);
});

test("safe cart lines reject private material and totals inconsistent with current price", () => {
  const line = schema("cartRuntimeItemViewSchema");
  const unavailable = {
    schemaVersion: 1,
    id: id(10),
    version: 1,
    quantity: 2,
    displayMode: "anonymous",
    nicknameProvided: false,
    hasFanMessage: false,
    idol: null,
    gift: null,
    price: { status: "UNAVAILABLE", observedPriceId: id(4), current: null },
    availability: {
      status: "UNAVAILABLE",
      reason: "CONTENT_UNAVAILABLE",
      maxQuantity: 0,
    },
  };
  expect(line.safeParse(unavailable).success).toBe(true);
  for (const extra of [
    { fanMessage: "private" },
    { supportIntentId: id(11) },
    { encryptedDataKey: "private" },
    { displayName: "private" },
  ])
    expect(line.safeParse({ ...unavailable, ...extra }).success).toBe(false);
  expect(
    line.safeParse({
      ...unavailable,
      price: {
        status: "CURRENT",
        observedPriceId: id(4),
        current: { priceId: id(4), unitAmountMinor: 3, lineTotalMinor: 5 },
      },
    }).success,
  ).toBe(false);
  expect(
    line.safeParse({
      ...unavailable,
      price: { status: "CURRENT", observedPriceId: id(4), current: null },
    }).success,
  ).toBe(false);
});
