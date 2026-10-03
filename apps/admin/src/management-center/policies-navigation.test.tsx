import { isValidElement, type ComponentProps, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { ManagementShell } from "./shell";

test.each([
  ["en", "Page management"],
  ["zh-CN", "页面管理"],
  ["th", "จัดการหน้า"],
  ["vi", "Quản lý trang"],
  ["ja", "ページ管理"],
  ["es", "Gestión de páginas"],
  ["pt", "Gestão de páginas"],
] as const)(
  "%s exposes the authorised policies destination",
  (locale, label) => {
    const props: ComponentProps<typeof ManagementShell> = {
      locale,
      section: "POLICIES",
      policiesAvailable: true,
      contentAllowed: false,
      onSection: vi.fn(),
      children: null,
    };
    const html = renderToStaticMarkup(<ManagementShell {...props} />);
    expect(html).toContain('data-management-section="PAGES"');
    expect(html).not.toContain('data-management-section="POLICIES"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain(label);
    expect(html).not.toContain('data-management-section="GIFTS"');
  },
);

test("the policy entry stays hidden without explicit access", () => {
  const html = renderToStaticMarkup(
    <ManagementShell locale="en" section="ARTISTS" onSection={() => {}}>
      <p>Content</p>
    </ManagementShell>,
  );
  expect(html).not.toContain('data-management-section="PAGES"');
});

function pageEntry(
  node: unknown,
): ReactElement<{ onClick: () => void; disabled: boolean }> | undefined {
  if (Array.isArray(node)) return node.map(pageEntry).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(node)) return;
  if (node.props["data-management-section"] === "PAGES")
    return node as ReturnType<typeof pageEntry>;
  return pageEntry(node.props["children"]);
}
test.each([
  [true, true, "INFO_PAGES"],
  [true, false, "INFO_PAGES"],
  [false, true, "POLICIES"],
] as const)(
  "one pages entry chooses an authorized initial tab (%s, %s)",
  (infoPagesAvailable, policiesAvailable, expected) => {
    const onSection = vi.fn();
    const props: ComponentProps<typeof ManagementShell> = {
      locale: "en",
      section: "ARTISTS",
      onSection,
      infoPagesAvailable,
      policiesAvailable,
      children: null,
    };
    const tree = ManagementShell(props);
    const html = renderToStaticMarkup(tree);
    expect(html.match(/data-management-section="PAGES"/g)).toHaveLength(1);
    expect(html).not.toContain('data-management-section="INFO_PAGES"');
    pageEntry(tree)!.props.onClick();
    expect(onSection).toHaveBeenCalledWith(expected);
  },
);
test.each(["INFO_PAGES", "POLICIES"] as const)(
  "clicking the current pages entry preserves %s without navigation",
  (section) => {
    const onSection = vi.fn();
    const tree = ManagementShell({
      locale: "en",
      section,
      onSection,
      infoPagesAvailable: true,
      policiesAvailable: true,
      children: null,
    });
    pageEntry(tree)!.props.onClick();
    expect(onSection).not.toHaveBeenCalled();
  },
);
test("busy pages navigation is disabled and cannot activate through its callback", () => {
  const onSection = vi.fn();
  const tree = ManagementShell({
    locale: "en",
    section: "ARTISTS",
    onSection,
    infoPagesAvailable: true,
    disabled: true,
    children: null,
  });
  expect(pageEntry(tree)!.props.disabled).toBe(true);
  pageEntry(tree)!.props.onClick();
  expect(onSection).not.toHaveBeenCalled();
});
