import { expect, test } from "vitest";
import {
  cartEditUpdateCommandSchema,
  cartEditRemoveCommandSchema,
  cartEditorReadCommandSchema,
  cartEditorContentSchema,
} from "./cart-edit.js";

const target = {
  schemaVersion: 1,
  itemId: "a0000000-0000-4000-8000-000000000001",
  expectedCartVersion: 2,
  expectedItemVersion: 1,
  presentationLocale: "en",
};
test("cart edits bind explicit item/cart versions and positive integer quantity", () => {
  const command = {
    ...target,
    operation: "UPDATE_CART_ITEM",
    change: {
      kind: "QUANTITY",
      quantity: 2,
      observedPriceId: "a0000000-0000-4000-8000-000000000002",
    },
  };
  expect(cartEditUpdateCommandSchema.parse(command)).toEqual(command);
  for (const change of [
    { ...command.change, quantity: 0 },
    { ...command.change, quantity: 1.5 },
    { ...command.change, giftId: target.itemId },
  ])
    expect(
      cartEditUpdateCommandSchema.safeParse({ ...command, change }).success,
    ).toBe(false);
  expect(
    cartEditUpdateCommandSchema.safeParse({
      ...command,
      expectedItemVersion: undefined,
    }).success,
  ).toBe(false);
  expect(
    cartEditRemoveCommandSchema.parse({
      ...target,
      operation: "REMOVE_CART_ITEM",
    }).itemId,
  ).toBe(target.itemId);
  expect(
    cartEditorReadCommandSchema.parse({
      ...target,
      operation: "READ_CART_ITEM_EDITOR",
    }).itemId,
  ).toBe(target.itemId);
});
test("personalization preserves Unicode rules and distinguishes absent text from invented content", () => {
  const command = {
    ...target,
    operation: "UPDATE_CART_ITEM",
    change: {
      kind: "PERSONALIZATION",
      displayMode: "anonymous",
      fanMessageLocale: "und",
    },
  };
  expect(cartEditUpdateCommandSchema.parse(command)).toEqual(command);
  expect(
    cartEditUpdateCommandSchema.safeParse({
      ...command,
      change: { ...command.change, displayName: "hidden" },
    }).success,
  ).toBe(false);
  for (const fanMessage of ["😀".repeat(281), "\ud800", ""])
    expect(
      cartEditUpdateCommandSchema.safeParse({
        ...command,
        change: { ...command.change, fanMessage },
      }).success,
    ).toBe(false);
  expect(
    cartEditorContentSchema.parse({
      displayMode: "nickname",
      displayName: "😀".repeat(40),
      fanMessageLocale: "ja",
      fanMessage: "😀".repeat(280),
    }).displayMode,
  ).toBe("nickname");
  expect(
    cartEditorContentSchema.safeParse({
      displayMode: "nickname",
      fanMessageLocale: "und",
    }).success,
  ).toBe(false);
  expect(
    cartEditorContentSchema.safeParse({
      displayMode: "anonymous",
      fanMessageLocale: "und",
      encryptedDataKey: "secret",
    }).success,
  ).toBe(false);
});
