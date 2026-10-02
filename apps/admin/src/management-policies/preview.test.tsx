import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
const subject = await import("./preview").catch(() => undefined);
test("policy preview renders validated paragraphs and emphasis instead of escaped markup", () => {
  expect(subject?.PolicyPreview).toBeTypeOf("function");
  const html = renderToStaticMarkup(
    createElement(subject!.PolicyPreview, {
      locale: "en",
      title: "Terms",
      summary: "Summary",
      body: "<p>Read <strong>carefully</strong>.</p>",
      invalidLabel: "Invalid content",
    }),
  );
  expect(html).toContain("<p>Read <strong>carefully</strong>.</p>");
  expect(html).not.toContain("&lt;p&gt;");
});
test("policy preview refuses unsafe markup instead of silently changing legal text", () => {
  expect(subject?.PolicyPreview).toBeTypeOf("function");
  const html = renderToStaticMarkup(
    createElement(subject!.PolicyPreview, {
      locale: "en",
      title: "Terms",
      summary: "Summary",
      body: '<img src="x" onerror="alert(1)">',
      invalidLabel: "Invalid content",
    }),
  );
  expect(html).toContain("Invalid content");
  expect(html).not.toContain("<img");
});
