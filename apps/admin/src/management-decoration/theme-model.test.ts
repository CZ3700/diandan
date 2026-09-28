import { expect, test } from "vitest";
import { createDefaultStorefrontTheme } from "@fan-support/contracts";
import { editableTheme, sameTheme } from "./theme-model";

const presentation = {
  heroLayout: "IMMERSIVE" as const,
  giftLayout: "GRID" as const,
  motion: "STANDARD" as const,
  motionSpeed: "STANDARD" as const,
};

test.each([
  { heroLayout: "SPLIT" as const },
  { giftLayout: "SHOWCASE" as const },
  { motion: "SUBTLE" as const },
  { motion: "NONE" as const },
  { motionSpeed: "QUICK" as const },
])("presentation-only edits are unsaved changes: %j", (change) => {
  const legacy = createDefaultStorefrontTheme();
  const next = { ...legacy, presentation: { ...presentation, ...change } };
  expect(sameTheme(legacy, next)).toBe(false);
  expect(sameTheme(next, legacy)).toBe(false);
});

test("explicit presentation defaults compare equally without rewriting legacy DTOs", () => {
  const legacy = createDefaultStorefrontTheme();
  const explicit = { ...legacy, presentation };
  expect(sameTheme(legacy, explicit)).toBe(true);
  expect(sameTheme(explicit, legacy)).toBe(true);
  expect(legacy).not.toHaveProperty("presentation");
  const state = {
    schemaVersion: 1 as const,
    version: 1,
    draft: {
      revisionId: "a0000000-0000-4000-8000-000000000001",
      createdAt: "2026-09-28T00:00:00Z",
      theme: legacy,
    },
    published: null,
  };
  expect(editableTheme(state)).toBe(legacy);
  expect(
    editableTheme({ ...state, draft: { ...state.draft, theme: explicit } }),
  ).toBe(explicit);
});
