import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import {
  createDefaultStorefrontTheme,
  createDefaultStorefrontPresentation,
  createDefaultStorefrontDetailTemplates,
  resolveStorefrontDetailTemplates,
  storefrontDetailTemplatesSchema,
  storefrontThemeSchema,
  storefrontThemeCommandSchema,
  storefrontThemePreviewMessageSchema,
} from "./index.js";

const defaults = { artist: "IMMERSIVE", gift: "IMAGE_LEFT" };
const oldTheme = createDefaultStorefrontTheme();
const oldPresentation = createDefaultStorefrontPresentation();

test("all detail templates work independently of homepage presentation and survive preview", () => {
  for (const artist of ["IMMERSIVE", "SPLIT"])
    for (const gift of ["IMAGE_LEFT", "IMAGE_RIGHT"])
      for (const base of [
        oldTheme,
        { ...oldTheme, presentation: oldPresentation },
      ]) {
        const detailTemplates = { artist, gift };
        const theme = { ...base, detailTemplates };
        expect(storefrontThemeSchema.safeParse(theme).success).toBe(true);
        expect(storefrontThemeSchema.parse(theme)).toEqual(theme);
        expect(storefrontDetailTemplatesSchema.parse(detailTemplates)).toEqual(
          detailTemplates,
        );
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

test("details reject partial, null, executable, commerce and unknown options", () => {
  for (const detailTemplates of [
    undefined,
    null,
    [],
    {},
    "SPLIT",
    { artist: "SPLIT" },
    { gift: "IMAGE_LEFT" },
    { ...defaults, artist: null },
    { ...defaults, gift: "STACKED" },
    { ...defaults, artist: "CUSTOM" },
    { ...defaults, gift: undefined },
    { ...defaults, css: "body{}" },
    { ...defaults, script: "alert(1)" },
    { ...defaults, price: 100 },
  ])
    for (const base of [
      oldTheme,
      { ...oldTheme, presentation: oldPresentation },
    ])
      expect(
        storefrontThemeSchema.safeParse({ ...base, detailTemplates }).success,
      ).toBe(false);
  expect(
    storefrontThemeSchema.safeParse({
      ...oldTheme,
      presentation: { ...oldPresentation, motion: "CUSTOM" },
      detailTemplates: defaults,
    }).success,
  ).toBe(false);
});

test("detail display defaults remain independent and never enter either old theme generation", () => {
  expect(createDefaultStorefrontDetailTemplates()).toEqual(defaults);
  for (const theme of [
    oldTheme,
    { ...oldTheme, presentation: oldPresentation },
  ]) {
    const original = JSON.stringify(theme);
    expect(resolveStorefrontDetailTemplates(theme)).toEqual(defaults);
    resolveStorefrontDetailTemplates(theme).artist = "SPLIT";
    expect(createDefaultStorefrontDetailTemplates()).toEqual(defaults);
    expect(JSON.stringify(storefrontThemeSchema.parse(theme))).toBe(original);
    expect(Object.hasOwn(theme, "detailTemplates")).toBe(false);
  }
  const configured = storefrontThemeSchema.parse({
    ...oldTheme,
    detailTemplates: defaults,
  });
  resolveStorefrontDetailTemplates(configured).gift = "IMAGE_RIGHT";
  expect(configured).toEqual({ ...oldTheme, detailTemplates: defaults });
});

test("both previous theme generations preserve exact command JSON and receipt hashes", () => {
  const hash = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  const presentations = [];
  for (const heroLayout of ["IMMERSIVE", "SPLIT"])
    for (const giftLayout of ["GRID", "SHOWCASE"])
      for (const motion of ["STANDARD", "SUBTLE", "NONE"])
        for (const motionSpeed of ["STANDARD", "QUICK"])
          presentations.push({ heroLayout, giftLayout, motion, motionSpeed });
  for (const palette of ["BLACK_GOLD", "GRAPHITE_PEARL", "MIDNIGHT_BLUE"])
    for (const typography of ["STANDARD", "LARGE"])
      for (const density of ["STANDARD", "COMPACT", "AIRY"])
        for (const corners of ["SOFT", "SHARP", "ROUND"])
          for (const presentation of [undefined, ...presentations]) {
            const theme = {
              schemaVersion: 1,
              palette,
              typography,
              density,
              corners,
              ...(presentation ? { presentation } : {}),
            };
            const command = {
              schemaVersion: 1,
              expectedVersion: 7,
              idempotencyKey: "old-detail-theme-command",
              action: "SAVE_DRAFT",
              theme,
            };
            const parsed = storefrontThemeCommandSchema.parse({
              theme,
              action: command.action,
              expectedVersion: command.expectedVersion,
              idempotencyKey: command.idempotencyKey,
              schemaVersion: 1,
            });
            expect(JSON.stringify(parsed)).toBe(JSON.stringify(command));
            expect(hash(JSON.stringify(parsed))).toBe(
              hash(JSON.stringify(command)),
            );
          }
});
