import { expect, test } from "vitest";
import {
  cartEditLoadItemCommandSchema,
  cartEditPrivateSnapshotSchema,
  cartEditWriteMutationCommandSchema,
} from "./cart-edit-internal.js";
import { cartEditEventSchema } from "./cart-edit-events.js";
import { cartRuntimeResponseSchema } from "./cart-runtime.js";
import {
  cartRuntimeCurrentResponseSchema,
  cartEditorResponseSchema,
} from "./cart-edit.js";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-09-08T16:00:00.123456Z";
const accesses = [
  { schemaVersion: 1, tokenDigest: "a".repeat(64), pepperVersion: "test-v1" },
];
const target = {
  schemaVersion: 1,
  accesses,
  cartId: id(1),
  itemId: id(2),
  expectedCartVersion: 2,
  expectedItemVersion: 1,
};
const privateContent = {
  fanMessageCiphertext: null,
  displayNameCiphertext: null,
  encryptedDataKey: "enc:v1:" + "A".repeat(40),
  encryptionKeyVersion: "key-v1",
};
const snapshot = {
  schemaVersion: 1,
  cart: {
    schemaVersion: 1,
    id: id(1),
    version: 2,
    status: "ACTIVE",
    presentationLocale: "en",
    market: "TEST",
    currency: "USD",
    expired: false,
    expiresAt: "2026-09-09T16:00:00Z",
    createdAt: at,
    updatedAt: at,
  },
  item: {
    schemaVersion: 1,
    id: id(2),
    cartId: id(1),
    giftId: id(3),
    giftVariantId: id(4),
    idolId: id(5),
    version: 1,
    quantity: 2,
    observedPriceId: id(6),
    displayMode: "anonymous",
    nicknameProvided: false,
    hasFanMessage: false,
  },
  supportIntentId: id(7),
  intentVersion: 1,
  fanMessageLocale: "und",
};
test("private snapshot requires exact projection flags, ownership and a persisted audit identity", () => {
  const value = {
    schemaVersion: 1,
    snapshot,
    privateContent,
    accessAuditId: id(8),
  };
  expect(cartEditPrivateSnapshotSchema.parse(value)).toEqual(value);
  for (const input of [
    { ...value, accessAuditId: undefined },
    {
      ...value,
      snapshot: { ...snapshot, item: { ...snapshot.item, cartId: id(9) } },
    },
    {
      ...value,
      privateContent: {
        ...privateContent,
        displayNameCiphertext: "enc:v1:" + "A".repeat(40),
      },
    },
    {
      ...value,
      snapshot: {
        ...snapshot,
        item: { ...snapshot.item, hasFanMessage: true },
      },
    },
  ])
    expect(cartEditPrivateSnapshotSchema.safeParse(input).success).toBe(false);
});
test("write schemas bind both resource versions, current intent version and encrypted material shape", () => {
  const value = {
    ...target,
    expectedIntentVersion: 1,
    receiptId: id(10),
    eventId: id(11),
    requestId: id(12),
    correlationId: id(13),
    presentationLocale: "ja",
    change: {
      kind: "PERSONALIZATION",
      displayMode: "anonymous",
      fanMessageLocale: "und",
      privateContent,
    },
  };
  expect(cartEditWriteMutationCommandSchema.parse(value)).toEqual(value);
  expect(
    cartEditWriteMutationCommandSchema.safeParse({
      ...value,
      change: { ...value.change, fanMessage: "private" },
    }).success,
  ).toBe(false);
  expect(
    cartEditWriteMutationCommandSchema.safeParse({
      ...value,
      change: { ...value.change, displayMode: "nickname" },
    }).success,
  ).toBe(false);
  expect(
    cartEditWriteMutationCommandSchema.safeParse({
      ...value,
      expectedIntentVersion: 0,
    }).success,
  ).toBe(false);
  expect(
    cartEditLoadItemCommandSchema.safeParse({ ...target, accesses: [] })
      .success,
  ).toBe(false);
});
test("new safe event and removed-add response are independent of historical roots", () => {
  const event = {
    schemaVersion: 1,
    eventId: id(11),
    eventType: "CART_ITEM_UPDATED",
    aggregateId: id(1),
    occurredAt: at,
    requestId: id(12),
    correlationId: id(13),
    payload: { cartId: id(1), cartItemId: id(2), receiptId: id(10) },
  };
  expect(cartEditEventSchema.parse(event)).toEqual(event);
  expect(
    cartEditEventSchema.safeParse({
      ...event,
      payload: { ...event.payload, fanMessage: "private" },
    }).success,
  ).toBe(false);
  expect(
    cartEditEventSchema.safeParse({
      ...event,
      payload: { ...event.payload, cartId: id(9) },
    }).success,
  ).toBe(false);
  const removed = {
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CART_ITEM_REMOVED",
  };
  expect(cartRuntimeResponseSchema.safeParse(removed).success).toBe(false);
  expect(cartRuntimeCurrentResponseSchema.parse(removed)).toEqual(removed);
  expect(
    cartEditorResponseSchema.safeParse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: "EDITOR_READ",
      cartItemId: id(2),
      cartVersion: 2,
      itemVersion: 1,
      content: { displayMode: "anonymous", fanMessageLocale: "und" },
      privateContent,
    }).success,
  ).toBe(false);
});
