import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { DeletePanel } from "./delete-panel";
import { managementCopy } from "./copy";

it("explains a permanent delete in every language and starts with the delete button disabled", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const copy = managementCopy(locale);
    const html = renderToStaticMarkup(
      <DeletePanel
        locale={locale}
        name="测试艺人"
        nameLocale="zh-CN"
        disabled={false}
        onDelete={() => {}}
      />,
    );
    expect(html).toContain(copy.deleteWarning);
    expect(html).toContain('<strong lang="zh-CN">测试艺人</strong>');
    expect(html).toMatch(
      /<button data-management-delete-confirm="true"[^>]* disabled=""/u,
    );
    expect(html).toContain('for="management-delete-name"');
  }
});
