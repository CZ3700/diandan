import { expect, test } from "vitest";
const subject = await import("./information-preview-protocol").catch(
  () => undefined,
);
const channel = "a0000000-0000-4000-8000-000000000001";
const document = {
  schemaVersion: 1,
  pageKey: "FAQ",
  locale: "zh-CN",
  revisionId: channel,
  sourceStatus: "CURRENT",
  structure: { sectionIds: [channel], contactEmail: null },
  fields: {
    title: "测试",
    summary: "",
    sections: [{ id: channel, heading: "测试？", body: "测试正文" }],
  },
};
test("preview requires the exact parent, origin, channel, page and locale and rejects internal fields", () => {
  expect(subject?.receiveInformationPreview).toBeTypeOf("function");
  const parent = {},
    origin = "https://admin.example.invalid";
  const context = {
    parent,
    adminOrigin: origin,
    channel,
    pageKey: "FAQ" as const,
    locale: "zh-CN" as const,
  };
  const event = {
    origin,
    source: parent,
    data: {
      schemaVersion: 1,
      type: "INFORMATION_PAGE_PREVIEW_RENDER",
      channel,
      document,
    },
  };
  expect(subject!.receiveInformationPreview(event, context)).toEqual(document);
  for (const invalid of [
    { ...event, source: {} },
    { ...event, origin: "https://other.example.invalid" },
    {
      ...event,
      data: { ...event.data, channel: "b0000000-0000-4000-8000-000000000001" },
    },
    ...[
      { locale: "en" },
      { pageKey: "ABOUT" },
      { actorId: channel },
      { sourceStatus: "STALE" },
    ].map((change) => ({
      ...event,
      data: { ...event.data, document: { ...document, ...change } },
    })),
  ])
    expect(subject!.receiveInformationPreview(invalid, context)).toBeNull();
});
