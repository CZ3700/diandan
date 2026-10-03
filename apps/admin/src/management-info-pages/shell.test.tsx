import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ManagementShell } from "../management-center/shell";
test("information pages remain available to scoped reviewers without daily upload access", () => {
  const html = renderToStaticMarkup(
    <ManagementShell
      locale="zh-CN"
      section="INFO_PAGES"
      onSection={() => {}}
      contentAllowed={false}
      infoPagesAvailable
    >
      <p>Review</p>
    </ManagementShell>,
  );
  expect(html).toContain('data-management-section="PAGES"');
  expect(html).toContain("页面管理");
  expect(html).not.toContain('data-management-section="ARTISTS"');
});
