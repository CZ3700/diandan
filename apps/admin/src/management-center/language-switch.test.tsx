import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { ManagementShell } from "./shell";

test("the daily management center exposes all seven interface languages including Chinese", () => {
  const html = renderToStaticMarkup(
    <ManagementShell locale="zh-CN" section="ARTISTS" onSection={() => {}}>
      Content
    </ManagementShell>,
  );
  expect(html).toContain("data-management-language");
  expect(html).toContain('value="zh-CN" selected=""');
  for (const locale of SUPPORTED_LOCALES)
    expect(html).toContain(`value="${locale}"`);
  expect(html).toContain("界面语言");
});

import { vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
function findLanguage(
  node: unknown,
): ReactElement<{ onChange: (event: unknown) => void }> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findLanguage(child);
      if (match) return match;
    }
  }
  if (!isValidElement(node)) return undefined;
  const props = node.props as Record<string, unknown>;
  if ("data-management-language" in props)
    return node as ReactElement<{ onChange: (event: unknown) => void }>;
  return findLanguage(props["children"]);
}
test("canceling a language change preserves the route and a confirmed change navigates once", () => {
  const assign = vi.fn();
  vi.stubGlobal("window", { location: { assign } });
  try {
    for (const allowed of [false, true]) {
      const beforeLeave = vi.fn(() => allowed);
      const shell = ManagementShell({
        locale: "en",
        section: "ARTISTS",
        onSection() {},
        beforeLeave,
        children: null,
      });
      findLanguage(shell)!.props.onChange({
        currentTarget: { value: "zh-CN" },
      });
      expect(beforeLeave).toHaveBeenCalledOnce();
      expect(assign).toHaveBeenCalledTimes(allowed ? 1 : 0);
    }
    expect(assign).toHaveBeenCalledWith("/zh-CN");
  } finally {
    vi.unstubAllGlobals();
  }
});
