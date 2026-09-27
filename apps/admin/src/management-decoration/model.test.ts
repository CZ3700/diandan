import { expect, test } from "vitest";
import { createDefaultHomeLayout } from "@fan-support/contracts";
const subject = await import("./model").catch(() => undefined);
test("operator can move a section one step and hide optional sections, preserving all required entries", () => {
  expect(subject?.moveSection).toBeTypeOf("function");
  const original = createDefaultHomeLayout();
  const next = subject!.moveSection(original, "GIFTS", -1);
  expect(next.sections.map((section) => section.id).slice(0, 4)).toEqual([
    "HERO",
    "KINDS",
    "GIFTS",
    "ARTISTS",
  ]);
  expect(original.sections[2]?.id).toBe("ARTISTS");
  expect(
    subject!
      .setSectionVisible(next, "HOW_IT_WORKS", false)
      .sections.find((section) => section.id === "HOW_IT_WORKS")?.visible,
  ).toBe(false);
  expect(subject!.setSectionVisible(next, "ARTISTS", false)).toEqual(next);
  expect(subject!.moveSection(original, "HERO", -1)).toEqual(original);
});
