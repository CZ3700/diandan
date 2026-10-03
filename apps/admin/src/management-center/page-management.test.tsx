import { isValidElement, type ReactElement } from "react";
import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
vi.mock("react", async (original) => ({
  ...(await original<typeof React>()),
  useId: () => "page-tabs",
  useState: (initial: unknown) => [initial, vi.fn()],
  useEffect: () => {},
  useRef: (initial: unknown) => ({ current: initial }),
}));
import { PageManagement } from "./page-management";
function elements(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props["children"])];
}
function render(
  infoPagesAvailable = true,
  policiesAvailable = true,
  busy = false,
) {
  const onSection = vi.fn();
  const tree = PageManagement({
    locale: "en",
    active: infoPagesAvailable ? "INFO_PAGES" : "POLICIES",
    infoPagesAvailable,
    policiesAvailable,
    busy,
    onSection,
    children: <p>Active editor</p>,
  });
  return {
    tree,
    onSection,
    tabs: elements(tree).filter((node) => node.props["role"] === "tab"),
  };
}
test.each([
  [true, true, 2],
  [true, false, 1],
  [false, true, 1],
  [false, false, 0],
] as const)(
  "authorized tabs and labelled panels (%s, %s)",
  (info, policies, count) => {
    const { tree, tabs } = render(info, policies);
    expect(tabs).toHaveLength(count);
    if (!count) return;
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("<h1>Page management</h1>");
    expect(html).toContain('role="tablist"');
    expect(tabs.filter((tab) => tab.props["aria-selected"])).toHaveLength(1);
    for (const tab of tabs) {
      const panel = elements(tree).find(
        (node) => node.props["id"] === tab.props["aria-controls"],
      );
      expect(panel?.props["role"]).toBe("tabpanel");
      expect(panel?.props["aria-labelledby"]).toBe(tab.props["id"]);
    }
  },
);
test("arrows, Home and End only move focus; a click activates through the guarded callback", () => {
  const { tabs, onSection } = render();
  const focuses = tabs.map(() => vi.fn());
  tabs.forEach((tab, index) =>
    (tab.props["ref"] as (node: unknown) => void)({ focus: focuses[index] }),
  );
  const key = (index: number, value: string) =>
    (tabs[index]!.props["onKeyDown"] as (event: unknown) => void)({
      key: value,
      preventDefault: vi.fn(),
    });
  key(0, "ArrowRight");
  expect(focuses[1]).toHaveBeenCalledOnce();
  key(1, "ArrowRight");
  expect(focuses[0]).toHaveBeenCalledOnce();
  key(0, "End");
  expect(focuses[1]).toHaveBeenCalledTimes(2);
  key(1, "Home");
  expect(focuses[0]).toHaveBeenCalledTimes(2);
  key(0, "ArrowLeft");
  expect(focuses[1]).toHaveBeenCalledTimes(3);
  expect(onSection).not.toHaveBeenCalled();
  (tabs[1]!.props["onClick"] as () => void)();
  expect(onSection).toHaveBeenCalledWith("POLICIES");
});
test("busy and selected tabs do not invoke navigation", () => {
  const active = render();
  (active.tabs[0]!.props["onClick"] as () => void)();
  expect(active.onSection).not.toHaveBeenCalled();
  const { tabs, onSection } = render(true, true, true);
  for (const tab of tabs) {
    expect(tab.props["disabled"]).toBe(true);
    (tab.props["onClick"] as () => void)();
  }
  expect(onSection).not.toHaveBeenCalled();
});
