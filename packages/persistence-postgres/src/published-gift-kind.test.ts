import { expect, test } from "vitest";
import type { GiftDirectoryRecord } from "@fan-support/contracts";
import {
  parsePublishedGiftKind,
  recordConfirmsGiftKind,
} from "./published-gift-kind.js";

const daily = (giftKind: string) =>
  ({
    schemaVersion: 3,
    context: { current: { document: { kind: "GIFT", giftKind } } },
  }) as unknown as GiftDirectoryRecord;
const legacy = { schemaVersion: 1 } as unknown as GiftDirectoryRecord;

test("a daily gift's SQL classification must equal its published document", () => {
  expect(recordConfirmsGiftKind(daily("VIRTUAL"), "VIRTUAL")).toBe(true);
  expect(recordConfirmsGiftKind(daily("VIRTUAL"), "PHYSICAL")).toBe(false);
  expect(recordConfirmsGiftKind(daily("VIRTUAL"), null)).toBe(false);
});

test("legacy records carry no kind of their own and accept the profile or its absence", () => {
  expect(recordConfirmsGiftKind(legacy, "WISH")).toBe(true);
  expect(recordConfirmsGiftKind(legacy, null)).toBe(true);
});

test("only canonical kinds or NULL leave the database", () => {
  expect(parsePublishedGiftKind(null)).toBeNull();
  expect(parsePublishedGiftKind("MERCHANDISE")).toBe("MERCHANDISE");
  for (const value of ["virtual", "", 1, undefined])
    expect(() => parsePublishedGiftKind(value)).toThrow();
});
