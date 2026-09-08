import { expect, it } from "vitest";
const load = () => import("./checkout-preflight-internal.js").catch(() => null);
const id = "10000000-0000-4000-8000-000000000001";
const hash = "a".repeat(64);
it("defines bounded authenticated current reads instead of caller-supplied item facts", async () => {
  const schemas = await load();
  const command = {
    schemaVersion: 1,
    accesses: [{ schemaVersion: 1, tokenDigest: hash, pepperVersion: "v1" }],
    cartId: id,
    expectedCartVersion: 2,
    presentationLocale: "en",
  };
  expect(
    schemas?.checkoutPreflightLoadCurrentCommandSchema.safeParse(command)
      .success,
  ).toBe(true);
  expect(
    schemas?.checkoutPreflightLoadCurrentCommandSchema.safeParse({
      ...command,
      items: [],
    }).success,
  ).toBe(false);
});
it("requires real encrypted contact material and no plaintext in persistence commands", async () => {
  const schemas = await load();
  const contact = {
    id,
    emailCiphertext: `enc:v1:${"a".repeat(40)}`,
    encryptedDataKey: `enc:v1:${"b".repeat(40)}`,
    encryptionKeyVersion: "key-v1",
    emailLookupHmac: hash,
    lookupKeyVersion: "lookup-v1",
  };
  expect(
    schemas?.checkoutEncryptedContactSchema.safeParse(contact).success,
  ).toBe(true);
  expect(
    schemas?.checkoutEncryptedContactSchema.safeParse({
      ...contact,
      email: "test@example.test",
    }).success,
  ).toBe(false);
});
it("keeps receipt safe and microsecond event time exact", async () => {
  const schemas = await load();
  const receipt = {
    schemaVersion: 1,
    preflightId: id,
    cartId: id,
    cartVersion: 3,
    checkoutSessionId: id,
    orderId: id,
    publicOrderId: id,
    occurredAt: "2026-09-09T01:00:00.123456Z",
  };
  expect(
    schemas?.checkoutPreflightReceiptSchema.safeParse(receipt).success,
  ).toBe(true);
  expect(
    schemas?.checkoutPreflightReceiptSchema.safeParse({
      ...receipt,
      contact: "test@example.test",
    }).success,
  ).toBe(false);
});
