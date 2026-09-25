import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { managementCenterResponseSchema } from "@fan-support/contracts";
import { ManagementListView } from "./list-view";
import { PosterForm } from "./poster-form";
import type { ManagementList } from "./api";
const id = "10000000-0000-4000-8000-000000000001";
const listing = (value: object) =>
  managementCenterResponseSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "LIST",
    section: "ARTISTS",
    page: 1,
    pageSize: 12,
    totalItems: 0,
    items: [],
    ...value,
  }) as ManagementList;
it("shows an honest empty list without invented people or placeholder photos", () => {
  const html = renderToStaticMarkup(
    <ManagementListView
      locale="zh-CN"
      list={listing({})}
      busy={false}
      onSelect={() => {}}
      onPage={() => {}}
    />,
  );
  expect(html).toContain("添加第一位艺人");
  expect(html).not.toContain("<img");
  expect(html).not.toContain("data-management-item");
});
it("shows a true original-language name and editable photograph without technical identifiers", () => {
  const list = listing({
    totalItems: 1,
    items: [
      {
        kind: "ARTIST",
        id,
        version: 1,
        sourceLocale: "th",
        name: "ศิลปินทดสอบ",
        description: "คำอธิบาย",
        image: {
          url: "https://media.example.invalid/photo.webp",
          alt: "ศิลปิน",
        },
        status: "active",
        handle: "fixture-artist",
      },
    ],
  });
  const html = renderToStaticMarkup(
    <ManagementListView
      locale="zh-CN"
      list={list}
      busy={false}
      onSelect={() => {}}
      onPage={() => {}}
    />,
  );
  expect(html).toContain("ศิลปินทดสอบ");
  expect(html).toContain('lang="th"');
  expect(html).toContain('src="https://media.example.invalid/photo.webp"');
  expect(html).toContain("原文");
  expect(html).not.toContain(`>${id}<`);
});
it("provides a real upload and one replace action for the poster", () => {
  const html = renderToStaticMarkup(
    <PosterForm locale="zh-CN" busy={false} onSubmit={() => {}} />,
  );
  expect(html).toContain('type="file"');
  expect(html.match(/type="submit"/gu)).toHaveLength(1);
  expect(html).toContain("替换海报");
});

it("keeps an unavailable historical poster visible with no restore action", () => {
  const list = listing({
    section: "POSTERS",
    totalItems: 1,
    items: [
      {
        kind: "POSTER",
        id,
        version: 1,
        sourceLocale: "en",
        sourceRevisionId: id,
        current: false,
        canRestore: false,
        image: null,
        createdAt: "2026-09-08T00:00:00Z",
      },
    ],
  });
  const html = renderToStaticMarkup(
    <ManagementListView
      locale="zh-CN"
      list={list}
      busy={false}
      onSelect={() => {}}
      onPage={() => {}}
    />,
  );
  expect(html).toContain('data-management-kind="POSTER"');
  expect(html).toMatch(/<button[^>]*disabled=""/u);
  expect(html).toContain("图片暂不可用");
});
