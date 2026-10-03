import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
const read = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("../server/public-information-pages", () => ({
  readPublicInformationPageIndex: read,
}));
import { InformationPageFooter } from "./information-page-footer";
test("published information links retain public shopping context without carrying order credentials", async () => {
  read.mockResolvedValue({
    outcome: "SUCCESS",
    entries: [{ pageKey: "ABOUT", title: "测试说明" }],
  });
  const html = renderToStaticMarkup(
    await InformationPageFooter({
      locale: "zh-CN",
      contextQuery:
        "market=TEST&currency=USD&idol=a0000000-0000-4000-8000-000000000001&token=private&orderId=private&variant=private",
    }),
  );
  expect(html).toContain(
    "/zh-CN/about?market=TEST&amp;currency=USD&amp;idol=a0000000-0000-4000-8000-000000000001",
  );
  expect(html).not.toContain("private");
  read.mockResolvedValue({ outcome: "SUCCESS", entries: [] });
  expect(await InformationPageFooter({ locale: "en" })).toBeNull();
  read.mockResolvedValue({ outcome: "FAILURE", code: "CONTENT_UNAVAILABLE" });
  expect(await InformationPageFooter({ locale: "en" })).toBeNull();
});
