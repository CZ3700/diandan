import { expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { InformationReview } from "./review";
import { informationFixture } from "./fixture";
import { informationCopy } from "./copy";
import { translator } from "../workspace/components";
test("review capabilities, dirty drafts and source comparison stay explicit", () => {
  const base = informationFixture();
  const copy = informationCopy("zh-CN");
  const render = (dirty: boolean) =>
    renderToStaticMarkup(
      <InformationReview
        state={{
          ...base,
          locale: "zh-CN",
          capabilities: {
            ...base.capabilities,
            canSave: false,
            canApprove: true,
            canSubmit: false,
          },
          previousSource: base.source,
          changedPaths: ["title"],
        }}
        contentLocale="zh-CN"
        localeScopes={["zh-CN"]}
        busy={false}
        dirty={dirty}
        copy={copy}
        t={translator("zh-CN")}
        selectLocale={vi.fn()}
        onSubmitReview={vi.fn()}
        onApproveReview={vi.fn()}
      />,
    );
  const html = render(false);
  expect(html).toMatch(/<details[^>]*open/);
  expect(html).toContain(copy.source);
  expect(html).toMatch(/data-info-submit[^>]*disabled/);
  expect(html).not.toMatch(/data-info-approve[^>]*disabled/);
  expect(render(true)).toMatch(/data-info-approve[^>]*disabled/);
});
