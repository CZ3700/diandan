import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { ManagementShell } from "./shell";

test.each([
  ["en", "Policies"],
  ["zh-CN", "政策"],
  ["th", "นโยบาย"],
  ["vi", "Chính sách"],
  ["ja", "ポリシー"],
  ["es", "Políticas"],
  ["pt", "Políticas"],
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
    expect(html).toContain('data-management-section="POLICIES"');
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
  expect(html).not.toContain('data-management-section="POLICIES"');
});
