import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import {
  createDefaultStorefrontTheme,
  createDefaultStorefrontPresentation,
  resolveStorefrontPresentation,
  storefrontPresentationSchema,
  storefrontThemeSchema,
  storefrontThemeCommandSchema,
  storefrontThemePreviewMessageSchema,
} from "./index.js";

const presentation = {
  heroLayout: "IMMERSIVE",
  giftLayout: "GRID",
  motion: "STANDARD",
  motionSpeed: "STANDARD",
};

test("all deployed presentation combinations preserve their exact serialized fields", () => {
  for (const heroLayout of ["IMMERSIVE", "SPLIT"])
    for (const giftLayout of ["GRID", "SHOWCASE"])
      for (const motion of ["STANDARD", "SUBTLE", "NONE"])
        for (const motionSpeed of ["STANDARD", "QUICK"]) {
          const value = { heroLayout, giftLayout, motion, motionSpeed };
          const theme = {
            ...createDefaultStorefrontTheme(),
            presentation: value,
          };
          expect(storefrontThemeSchema.safeParse(theme).success).toBe(true);
          expect(storefrontThemeSchema.parse(theme)).toEqual(theme);
          expect(storefrontPresentationSchema.parse(value)).toEqual(value);
          expect(
            storefrontThemePreviewMessageSchema.safeParse({
              schemaVersion: 1,
              type: "STOREFRONT_THEME_PREVIEW",
              channel: "10000000-0000-4000-8000-000000000001",
              theme,
            }).success,
          ).toBe(true);
        }
});

test("presentation rejects partial, executable, arbitrary and non-JSON settings", () => {
  for (const value of [
    undefined,
    null,
    [],
    {},
    { ...presentation, heroLayout: "CUSTOM" },
    { ...presentation, giftLayout: "MASONRY" },
    { ...presentation, motion: "BOUNCE" },
    { ...presentation, motionSpeed: 100 },
    { ...presentation, motionSpeed: undefined },
    { ...presentation, css: "body{}" },
    { ...presentation, script: "alert(1)" },
    { ...presentation, price: 100 },
  ])
    expect(
      storefrontThemeSchema.safeParse({
        ...createDefaultStorefrontTheme(),
        presentation: value,
      }).success,
    ).toBe(false);
});

test("display defaults never mutate old theme JSON and return independent values", () => {
  const oldTheme = createDefaultStorefrontTheme();
  const original = JSON.stringify(oldTheme);
  expect(createDefaultStorefrontPresentation()).toEqual(presentation);
  expect(resolveStorefrontPresentation(oldTheme)).toEqual(presentation);
  const resolved = resolveStorefrontPresentation(oldTheme);
  resolved.heroLayout = "SPLIT";
  expect(createDefaultStorefrontPresentation()).toEqual(presentation);
  expect(JSON.stringify(oldTheme)).toBe(original);
  expect(
    Object.hasOwn(storefrontThemeSchema.parse(oldTheme), "presentation"),
  ).toBe(false);
  const configured = storefrontThemeSchema.parse({ ...oldTheme, presentation });
  resolveStorefrontPresentation(configured).motion = "NONE";
  expect(configured).toEqual({ ...oldTheme, presentation });
});

test("hero effects are deployed optional presets independent of motion and speed", () => {
  for (const heroEffect of ["STARLIGHT", "AURORA", "SPOTLIGHT", "PETALS"])
    for (const motion of ["STANDARD", "SUBTLE", "NONE"])
      for (const motionSpeed of ["STANDARD", "QUICK"]) {
        const value = { ...presentation, motion, motionSpeed, heroEffect };
        const theme = {
          ...createDefaultStorefrontTheme(),
          presentation: value,
        };
        expect(storefrontPresentationSchema.parse(value)).toEqual(value);
        expect(storefrontThemeSchema.parse(theme)).toEqual(theme);
        expect(
          resolveStorefrontPresentation(storefrontThemeSchema.parse(theme)),
        ).toEqual(value);
        expect(
          storefrontThemePreviewMessageSchema.parse({
            schemaVersion: 1,
            type: "STOREFRONT_THEME_PREVIEW",
            channel: "10000000-0000-4000-8000-000000000001",
            theme,
          }).theme,
        ).toEqual(theme);
      }
});

test("hero effect rejects arbitrary values, executable fields and invalid types", () => {
  for (const heroEffect of [
    "",
    "starlight",
    "CUSTOM",
    null,
    1,
    true,
    [],
    {},
    "url(evil)",
  ])
    expect(
      storefrontPresentationSchema.safeParse({ ...presentation, heroEffect })
        .success,
    ).toBe(false);
  expect(
    storefrontPresentationSchema.safeParse({
      ...presentation,
      heroEffect: "STARLIGHT",
      script: "alert(1)",
    }).success,
  ).toBe(false);
});

test("omitted hero effect preserves all prior presentation command bytes and hashes", () => {
  for (const heroLayout of ["IMMERSIVE", "SPLIT"])
    for (const giftLayout of ["GRID", "SHOWCASE"])
      for (const motion of ["STANDARD", "SUBTLE", "NONE"])
        for (const motionSpeed of ["STANDARD", "QUICK"])
          for (const includeDetails of [false, true]) {
            const theme = {
              ...createDefaultStorefrontTheme(),
              presentation: { heroLayout, giftLayout, motion, motionSpeed },
              ...(includeDetails
                ? { detailTemplates: { artist: "SPLIT", gift: "IMAGE_RIGHT" } }
                : {}),
            };
            const command = {
              schemaVersion: 1,
              expectedVersion: 7,
              idempotencyKey: "theme-presentation-idempotency",
              action: "SAVE_DRAFT",
              theme,
            };
            const parsed = storefrontThemeCommandSchema.parse(command);
            const hash = (value: unknown) =>
              createHash("sha256").update(JSON.stringify(value)).digest("hex");
            expect(JSON.stringify(parsed)).toBe(JSON.stringify(command));
            expect(hash(parsed)).toBe(hash(command));
            expect(
              resolveStorefrontPresentation(storefrontThemeSchema.parse(theme)),
            ).not.toHaveProperty("heroEffect");
          }
  expect(createDefaultStorefrontPresentation()).not.toHaveProperty(
    "heroEffect",
  );
  expect(
    resolveStorefrontPresentation(createDefaultStorefrontTheme()),
  ).not.toHaveProperty("heroEffect");
});

test("legacy commands retain their original field order and idempotency hash", () => {
  const hash = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  for (const palette of [
    "BLACK_GOLD",
    "GRAPHITE_PEARL",
    "MIDNIGHT_BLUE",
    "SAKURA_PINK",
    "SKY_BLUE",
    "IVORY_GOLD",
    "PEARL_GRAY",
  ])
    for (const typography of ["STANDARD", "LARGE"])
      for (const density of ["STANDARD", "COMPACT", "AIRY"])
        for (const corners of ["SOFT", "SHARP", "ROUND"]) {
          const theme = {
            schemaVersion: 1,
            palette,
            typography,
            density,
            corners,
          };
          const legacy = {
            schemaVersion: 1,
            expectedVersion: 7,
            idempotencyKey: "theme-legacy-idempotency",
            action: "SAVE_DRAFT",
            theme,
          };
          const parsed = storefrontThemeCommandSchema.parse({
            theme,
            action: legacy.action,
            idempotencyKey: legacy.idempotencyKey,
            expectedVersion: legacy.expectedVersion,
            schemaVersion: 1,
          });
          expect(JSON.stringify(parsed)).toBe(JSON.stringify(legacy));
          expect(hash(JSON.stringify(parsed))).toBe(
            hash(JSON.stringify(legacy)),
          );
        }
});
