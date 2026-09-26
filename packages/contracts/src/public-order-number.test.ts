import { expect, test } from "vitest";

import { publicOrderNoSchema } from "./identifiers.js";
import {
  PUBLIC_ORDER_NO_ALPHABET,
  normalizePublicOrderNo,
} from "./public-order-number.js";

test("accepts only FS- plus six Crockford base32 characters", () => {
  for (const valid of ["FS-7K3M9C", "FS-000000", "FS-ZZZZZZ"])
    expect(publicOrderNoSchema.safeParse(valid).success).toBe(true);
  for (const invalid of [
    "FS-7K3M9",
    "FS-7K3M9CX",
    "fs-7k3m9c",
    "7K3M9C",
    "FS-7K3M9I",
    "FS-7K3M9L",
    "FS-7K3M9O",
    "FS-7K3M9U",
    "FS 7K3M9C",
    "XS-7K3M9C",
  ])
    expect(publicOrderNoSchema.safeParse(invalid).success).toBe(false);
});

test("uses the 32-symbol Crockford alphabet without I, L, O or U", () => {
  expect(PUBLIC_ORDER_NO_ALPHABET).toHaveLength(32);
  expect(new Set(PUBLIC_ORDER_NO_ALPHABET).size).toBe(32);
  expect(PUBLIC_ORDER_NO_ALPHABET).not.toMatch(/[ILOU]/u);
});

test("normalizes what a fan or operator types or reads out", () => {
  for (const input of [
    "FS-7K3M9C",
    "fs-7k3m9c",
    " FS 7K3M9C ",
    "7k3m9c",
    "7K3-M9C",
    "fs7k3m9c",
  ])
    expect(normalizePublicOrderNo(input)).toBe("FS-7K3M9C");
  // Crockford decoding: O reads as zero, I and L read as one.
  expect(normalizePublicOrderNo("FS-O0IL1o")).toBe("FS-001110");
  // Six characters are always the bare code, even when they start with F and S.
  expect(normalizePublicOrderNo("fs1234")).toBe("FS-FS1234");
});

test("rejects anything that is not exactly one public order number", () => {
  for (const input of [
    "",
    "FS-",
    "FS-7K3M9",
    "FS-7K3M9CC",
    "FS-7K3M9U",
    "FS-7K3M9*",
    "a0000000-0000-4000-8000-000000000011",
    "SS-7K3M9C",
    "FS-FS-7K3M9C",
    "x".repeat(200),
  ])
    expect(normalizePublicOrderNo(input)).toBeNull();
});
