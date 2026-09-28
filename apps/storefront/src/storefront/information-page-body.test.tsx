import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

const subject = await import("./information-page-body").catch(() => undefined);
const sectionId = "a0000000-0000-4000-8000-000000000001";
const document = {
  pageKey: "FAQ" as const,
  locale: "zh-CN" as const,
  revisionId: "b0000000-0000-4000-8000-000000000001",
  structure: { sectionIds: [sectionId], contactEmail: null },
  fields: {
    title: "测试常见问题",
    summary: "测试说明",
    sections: [
      { id: sectionId, heading: "如何查询？", body: "第一段。\n\n第二段。" },
    ],
  },
};
test("FAQ uses native keyboard-operable details and the same plain-text document renderer", () => {
  expect(subject?.InformationPageBody).toBeTypeOf("function");
  const html = renderToStaticMarkup(subject!.InformationPageBody({ document }));
  expect(html).toContain("<h1");
  expect(html).toContain('lang="zh-CN"');
  expect(html).toContain("<details");
  expect(html).toContain("<summary");
  expect(html).toContain("如何查询？");
  expect(html).toContain("<p>第一段。</p>");
  expect(html).toContain("<p>第二段。</p>");
  expect(html).not.toContain('role="button"');
});
test("about renders readable sections and escapes operator text rather than interpreting HTML", () => {
  expect(subject?.InformationPageBody).toBeTypeOf("function");
  const html = renderToStaticMarkup(
    subject!.InformationPageBody({
      document: {
        ...document,
        pageKey: "ABOUT",
        fields: {
          ...document.fields,
          sections: [
            {
              id: sectionId,
              heading: "Title <script>",
              body: '<img src=x onerror="alert(1)">\n\n& safe',
            },
          ],
        },
      },
    }),
  );
  expect(html).not.toContain("<details");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<img");
  expect(html).toContain("&lt;img");
  expect(html).toContain("<h2");
});
test("only support displays the validated contact address and an empty address creates no dead action", () => {
  expect(subject?.InformationPageBody).toBeTypeOf("function");
  const support = { ...document, pageKey: "SUPPORT" as const };
  expect(
    renderToStaticMarkup(subject!.InformationPageBody({ document: support })),
  ).not.toContain("mailto:");
  expect(
    renderToStaticMarkup(
      subject!.InformationPageBody({
        document: {
          ...support,
          structure: {
            ...support.structure,
            contactEmail: "test@example.invalid",
          },
        },
      }),
    ),
  ).toContain('href="mailto:test@example.invalid"');
});

test("inert saved previews can expose FAQ answers without enabling business or navigation controls", () => {
  expect(subject?.InformationPageBody).toBeTypeOf("function");
  const html = renderToStaticMarkup(
    subject!.InformationPageBody({ document, expandedQuestions: true }),
  );
  expect(html).toContain('open=""');
});
