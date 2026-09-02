import { expect, test } from "vitest";

import { publicMediaViewSchema } from "./presentation.js";

test("accepts only browser-safe HTTPS media URLs without userinfo", () => {
  expect(
    publicMediaViewSchema.safeParse({
      url: "https://media.example.invalid/gift.webp",
      alt: "Gift",
    }).success,
  ).toBe(true);
  expect(
    publicMediaViewSchema.safeParse({
      url: "https://user:password@media.example.invalid/private/object.webp",
      alt: "Gift",
    }).success,
  ).toBe(false);
  expect(
    publicMediaViewSchema.safeParse({
      url: "http://media.example.invalid/gift.webp",
      alt: "Gift",
    }).success,
  ).toBe(false);
});
