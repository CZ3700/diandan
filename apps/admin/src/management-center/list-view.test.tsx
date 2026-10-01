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
        assignment: null,
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
        canDelete: true,
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

it("offers delete for an old poster only, never for the homepage poster", () => {
  const poster = (posterId: string, current: boolean) => ({
    kind: "POSTER" as const,
    id: posterId,
    version: 3,
    sourceLocale: "en" as const,
    sourceRevisionId: posterId,
    current,
    canRestore: false,
    canDelete: !current,
    image: null,
    createdAt: "2026-09-08T00:00:00Z",
  });
  const current = "00000000-0000-4000-8000-00000000000a";
  const old = "00000000-0000-4000-8000-00000000000b";
  const list = listing({
    section: "POSTERS",
    totalItems: 2,
    items: [poster(current, true), poster(old, false)],
  });
  const render = (onDeletePoster?: () => void) =>
    renderToStaticMarkup(
      <ManagementListView
        locale="zh-CN"
        list={list}
        busy={false}
        onSelect={() => {}}
        onPage={() => {}}
        {...(onDeletePoster ? { onDeletePoster } : {})}
      />,
    );
  const html = render(() => {});
  expect(html).toContain(`data-management-poster-delete="${old}"`);
  expect(html).not.toContain(`data-management-poster-delete="${current}"`);
  expect(html).toContain(">删除<");
  expect(render()).not.toContain("data-management-poster-delete");
});

// ADR-022 / L3-11
const artist = (assignment: object | null) => ({
  kind: "ARTIST",
  id,
  version: 1,
  sourceLocale: "en",
  name: "Aria",
  description: "Description",
  image: null,
  status: "active",
  handle: "aria",
  assignment,
});
const render = (
  assignment: object | null,
  props: { showAssignment?: boolean; filtered?: boolean } = {},
) =>
  renderToStaticMarkup(
    <ManagementListView
      locale="zh-CN"
      list={listing({ totalItems: 1, items: [artist(assignment)] })}
      busy={false}
      onSelect={() => {}}
      onPage={() => {}}
      {...props}
    />,
  );
it("shows whom each artist belongs to only to accounts that manage every artist", () => {
  const broker = {
    brokerId: "10000000-0000-4000-8000-000000000002",
    displayName: "Mina Park",
    active: true,
  };
  const assigned = render(broker, { showAssignment: true });
  expect(assigned).toContain("归属经纪人 · Mina Park");
  expect(assigned).toContain(`data-management-assignment="${broker.brokerId}"`);
  const inactive = render(
    { ...broker, active: false },
    { showAssignment: true },
  );
  expect(inactive).toContain("Mina Park（已停用）");
  const unassigned = render(null, { showAssignment: true });
  expect(unassigned).toContain("未分配");
  expect(unassigned).toContain('data-management-assignment="UNASSIGNED"');
  // A broker's own list needs no such line.
  const own = render(broker);
  expect(own).not.toContain("归属经纪人");
  expect(own).not.toContain("data-management-assignment");
});
it("says nothing matched, not 'add the first artist', when a filter is on", () => {
  const empty = (filtered: boolean) =>
    renderToStaticMarkup(
      <ManagementListView
        locale="zh-CN"
        list={listing({})}
        busy={false}
        onSelect={() => {}}
        onPage={() => {}}
        filtered={filtered}
      />,
    );
  expect(empty(true)).toContain("没有找到匹配内容");
  expect(empty(true)).not.toContain("添加第一位艺人");
  expect(empty(false)).toContain("添加第一位艺人");
});
it("puts a wish's artist and status on their own row beside an unsplit price", () => {
  const html = renderToStaticMarkup(
    <ManagementListView
      locale="zh-CN"
      list={listing({
        section: "GIFTS",
        totalItems: 1,
        items: [
          {
            kind: "GIFT",
            id,
            version: 1,
            sourceLocale: "zh-CN",
            name: "心愿",
            description: "说明",
            image: null,
            status: "active",
            handle: "fixture-wish",
            giftKind: "WISH",
            category: "OTHER",
            price: { market: "US", currency: "USD", amountMinor: 2300 },
            inventory: {
              policy: "TRACKED",
              quantity: 1,
              locationId: "10000000-0000-4000-8000-000000000003",
            },
            eligibility: { rule: "EXPLICIT_ARTISTS" },
            canEdit: true,
            inventoryPolicyLocked: true,
            wish: {
              schemaVersion: 1,
              wishId: "10000000-0000-4000-8000-000000000004",
              artistId: "10000000-0000-4000-8000-000000000002",
              artistName: "A long artist display name",
              artistHandle: "fixture-artist",
              status: "AVAILABLE",
            },
          },
        ],
      })}
      busy={false}
      onSelect={() => {}}
      onPage={() => {}}
    />,
  );
  expect(html).toMatch(
    /<span class="mc-item-line mc-item-gift"><span>[^<]+<\/span><span class="mc-item-wish" data-management-wish-status="AVAILABLE">A long artist display name · /u,
  );
  expect(html).toContain('class="fs-price"');
});
