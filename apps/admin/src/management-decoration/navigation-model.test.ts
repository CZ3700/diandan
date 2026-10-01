import { expect, test } from "vitest";
import { navigationFixture } from "./navigation-fixture";
const model = await import("./navigation-model").catch(() => undefined);
test("header and footer moves preserve all entries and invalid edge moves keep the draft", () => {
  expect(model?.moveNavigationItem).toBeTypeOf("function");
  const initial = navigationFixture();
  const header = model!.moveNavigationItem(initial, "header", "GIFTS", -1);
  expect(header.header).toEqual(["HOME", "GIFTS", "ARTISTS"]);
  expect(header.footer).toBe(initial.footer);
  const footer = model!.moveNavigationItem(initial, "footer", "GIFTS", -1);
  expect(footer.footer.map((item) => item.id)).toEqual([
    "DESCRIPTION",
    "REGION",
    "GIFTS",
    "ARTISTS",
    "POLICIES",
  ]);
  expect(footer.header).toBe(initial.header);
  expect(model!.moveNavigationItem(initial, "header", "HOME", -1)).toBe(
    initial,
  );
  expect(model!.moveNavigationItem(initial, "footer", "POLICIES", 1)).toBe(
    initial,
  );
  expect(initial).toEqual(navigationFixture());
});
test("policies remain visible while optional footer items can be toggled", () => {
  expect(model?.setNavigationFooterVisible).toBeTypeOf("function");
  const initial = navigationFixture();
  expect(model!.setNavigationFooterVisible(initial, "POLICIES", false)).toBe(
    initial,
  );
  expect(model!.setNavigationFooterVisible(initial, "DESCRIPTION", false)).toBe(
    initial,
  );
  const changed = model!.setNavigationFooterVisible(initial, "GIFTS", true);
  expect(changed.footer.find((item) => item.id === "GIFTS")?.visible).toBe(
    true,
  );
  expect(initial.footer.find((item) => item.id === "GIFTS")?.visible).toBe(
    false,
  );
});
test("footer moves skip the retained description slot without rewriting its legacy value", () => {
  const initial = navigationFixture();
  const legacy = initial.footer[0]!;
  const withMiddleDescription = {
    ...initial,
    footer: [initial.footer[1]!, legacy, ...initial.footer.slice(2)],
  };
  const moved = model!.moveNavigationItem(
    withMiddleDescription,
    "footer",
    "ARTISTS",
    -1,
  );
  expect(moved.footer.map((item) => item.id)).toEqual([
    "ARTISTS",
    "DESCRIPTION",
    "REGION",
    "GIFTS",
    "POLICIES",
  ]);
  expect(moved.footer[1]).toBe(legacy);
  expect(model!.moveNavigationItem(initial, "footer", "REGION", -1)).toBe(
    initial,
  );
  expect(model!.moveNavigationItem(initial, "footer", "DESCRIPTION", 1)).toBe(
    initial,
  );
  expect(model!.moveNavigationItem(moved, "footer", "ARTISTS", 1)).toEqual(
    withMiddleDescription,
  );
});
test("semantic dirty comparison includes order and visibility and does not mutate saved state", () => {
  expect(model?.sameNavigation).toBeTypeOf("function");
  const initial = navigationFixture();
  expect(model!.sameNavigation(initial, structuredClone(initial))).toBe(true);
  expect(
    model!.sameNavigation(initial, {
      ...initial,
      header: ["GIFTS", "HOME", "ARTISTS"],
    }),
  ).toBe(false);
  expect(
    model!.sameNavigation(initial, {
      ...initial,
      footer: [...initial.footer].reverse(),
    }),
  ).toBe(false);
  expect(
    model!.sameNavigation(
      initial,
      model!.setNavigationFooterVisible(initial, "GIFTS", true),
    ),
  ).toBe(false);
  const state = {
    schemaVersion: 1 as const,
    version: 0,
    draft: null,
    published: null,
  };
  expect(model!.editableNavigation(state)).toEqual({
    ...initial,
    footer: initial.footer.map((item) =>
      item.id === "DESCRIPTION" ? { ...item, visible: false } : item,
    ),
  });
  const draft = {
    revisionId: "10000000-0000-4000-8000-000000000001",
    createdAt: "2026-09-28T00:00:00Z",
    navigation: initial,
  };
  expect(model!.editableNavigation({ ...state, draft })).toBe(initial);
});
