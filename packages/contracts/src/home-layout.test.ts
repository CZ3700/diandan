import { expect, test } from "vitest";
import {
  createDefaultHomeLayout,
  homeLayoutSchema,
  homeLayoutCommandSchema,
  publicHomeLayoutResponseSchema,
} from "./index.js";

test("default keeps artists directly before gifts and accepts explicit reordering", () => {
  const layout = createDefaultHomeLayout();
  expect(layout.sections.slice(2, 4).map((section) => section.id)).toEqual([
    "ARTISTS",
    "GIFTS",
  ]);
  expect(
    homeLayoutSchema.safeParse({
      ...layout,
      sections: [...layout.sections].reverse(),
    }).success,
  ).toBe(true);
});
test("rejects duplicate, missing, unknown, executable and hidden required sections", () => {
  const layout = createDefaultHomeLayout();
  for (const value of [
    { ...layout, sections: layout.sections.slice(1) },
    {
      ...layout,
      sections: layout.sections.map((row, i) =>
        i === 1 ? layout.sections[0] : row,
      ),
    },
    {
      ...layout,
      sections: layout.sections.map((row, i) =>
        i === 1 ? { ...row, id: "SCRIPT" } : row,
      ),
    },
    { ...layout, script: "alert(1)" },
    ...["HERO", "ARTISTS", "GIFTS"].map((id) => ({
      ...layout,
      sections: layout.sections.map((row) =>
        row.id === id ? { ...row, visible: false } : row,
      ),
    })),
  ])
    expect(homeLayoutSchema.safeParse(value).success).toBe(false);
});
test("save requires optimistic version and idempotency, public projection rejects draft and invented provenance", () => {
  expect(
    homeLayoutCommandSchema.safeParse({
      schemaVersion: 1,
      action: "SAVE_DRAFT",
      layout: createDefaultHomeLayout(),
    }).success,
  ).toBe(false);
  const published = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "HOME_LAYOUT",
    source: "DEFAULT",
    layout: createDefaultHomeLayout(),
    version: 0,
    publicationId: null,
  };
  expect(publicHomeLayoutResponseSchema.safeParse(published).success).toBe(
    true,
  );
  expect(
    publicHomeLayoutResponseSchema.safeParse({
      ...published,
      source: "PUBLISHED",
    }).success,
  ).toBe(false);
  expect(
    publicHomeLayoutResponseSchema.safeParse({ ...published, draft: {} })
      .success,
  ).toBe(false);
});
