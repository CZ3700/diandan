import { beforeEach, expect, test, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import type * as React from "react";
import {
  adminCatalogResponseSchema,
  idolIdSchema,
  SUPPORTED_LOCALES,
  slugSchema,
  type SupportedLocale,
  type WishGiftSummary,
} from "@fan-support/contracts";
import { managementCopy } from "./copy";
import { PhotoView } from "./photo-view";

const hooks = vi.hoisted(() => ({
  values: [] as unknown[],
  index: 0,
  effect: undefined as (() => void | (() => void)) | undefined,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof React>()),
  useEffect: (effect: () => void | (() => void)) => {
    hooks.effect = effect;
  },
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [
      hooks.values[index],
      (next: unknown) => {
        hooks.values[index] =
          typeof next === "function" ? next(hooks.values[index]) : next;
      },
    ];
  },
}));
const { WishArtistPicker } = await import("./wish-artist-picker");
const artistId = "10000000-0000-4000-8000-000000000002";
const owner = (id: string, acceptingGifts: boolean) => ({
  schemaVersion: 1,
  target: { kind: "IDOL", idolId: id },
  locale: "en",
  label: "Mira",
  status: "active",
  baseVersion: 1,
  authoringVersion: 1,
  publicationHeadVersion: 1,
  latestRevisionId: artistId,
  draftRevisionId: null,
  publishedRevisionId: artistId,
  handle: "mira",
  acceptingGifts,
  createdAt: "2026-10-01T00:00:00Z",
});
const page = adminCatalogResponseSchema.parse({
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "OWNERS",
  page: 1,
  pageSize: 10,
  totalItems: 2,
  items: [
    owner(artistId, true),
    owner("10000000-0000-4000-8000-000000000003", false),
  ],
});
if (page.outcome !== "SUCCESS" || page.kind !== "OWNERS")
  throw new Error("Expected artist page");
const wishArtists = vi.fn().mockResolvedValue(page);
const onChange = vi.fn();
function render(
  value = "",
  locale: SupportedLocale = "en",
  wish?: WishGiftSummary,
) {
  hooks.index = 0;
  return WishArtistPicker({
    api: { wishArtists },
    locale,
    copy: managementCopy(locale),
    value,
    wish,
    onChange,
    error: undefined,
  });
}
function elements(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props["children"])];
}
beforeEach(() => {
  hooks.values = [];
  hooks.index = 0;
  hooks.effect = undefined;
  vi.clearAllMocks();
  wishArtists.mockResolvedValue(page);
});

const image = {
  url: "https://media.example.test/artists/mira.webp",
  alt: "Mira portrait",
};
const portraitOwner = { ...page.items[0]!, image };

test.each(SUPPORTED_LOCALES)(
  "shows clickable artist portraits with names and keeps the chosen portrait in %s",
  (locale) => {
    hooks.values = [
      "",
      "",
      1,
      { ...page, items: [portraitOwner] },
      null,
      false,
      false,
      0,
    ];
    const options = elements(render("", locale)).filter(
      (node) => "data-management-wish-artist" in node.props,
    );
    const photo = elements(options[0]).find((node) => node.type === PhotoView);
    expect(photo?.props).toMatchObject({ src: image.url, alt: image.alt });
    expect(
      elements(options[0]).some((node) => node.props["children"] === "Mira"),
    ).toBe(true);
    (options[0]?.props["onClick"] as () => void)();
    const chosen = elements(render(artistId, locale)).find(
      (node) => node.props["className"] === "mc-wish-selected",
    );
    expect(
      elements(chosen).find((node) => node.type === PhotoView)?.props["src"],
    ).toBe(image.url);
    expect(onChange).toHaveBeenCalledWith(artistId);
  },
);

test.each(SUPPORTED_LOCALES)(
  "uses a readable localized fallback instead of an internal handle when a name or portrait is missing in %s",
  (locale) => {
    const unnamed = {
      ...portraitOwner,
      label: null,
      image: null,
      handle: "idol-eabf8c933f7b4abf90a3f0963aea262d",
    };
    hooks.values = [
      "",
      "",
      1,
      { ...page, items: [unnamed] },
      unnamed,
      false,
      false,
      0,
    ];
    const nodes = elements(render(artistId, locale));
    expect(
      nodes.some((node) => node.props["children"] === unnamed.handle),
    ).toBe(false);
    expect(
      nodes.filter(
        (node) => node.props["children"] === managementCopy(locale).untitled,
      ),
    ).toHaveLength(2);
    expect(
      nodes.some(
        (node) =>
          node.props["aria-label"] === managementCopy(locale).imageUnavailable,
      ),
    ).toBe(true);
    expect(nodes.some((node) => node.type === PhotoView)).toBe(false);
  },
);

test("searching and paging keep the selected artist portrait and name until explicitly changed", async () => {
  hooks.values = [
    "Luna",
    "",
    1,
    { ...page, totalItems: 20 },
    portraitOwner,
    false,
    false,
    0,
  ];
  const search = elements(render(artistId)).find(
    (node) => node.props["children"] === managementCopy("en").search,
  )!;
  (search.props["onClick"] as () => void)();
  wishArtists.mockResolvedValueOnce({ ...page, totalItems: 20, items: [] });
  render(artistId);
  hooks.effect?.();
  await vi.waitFor(() => expect(hooks.values[5]).toBe(false));
  expect(wishArtists).toHaveBeenLastCalledWith("en", 1, "Luna");
  let nodes = elements(render(artistId));
  expect(nodes.find((node) => node.type === PhotoView)?.props["src"]).toBe(
    image.url,
  );
  const next = nodes.find(
    (node) => node.props["children"] === managementCopy("en").next,
  )!;
  (next.props["onClick"] as () => void)();
  render(artistId);
  hooks.effect?.();
  await vi.waitFor(() => expect(hooks.values[5]).toBe(false));
  expect(wishArtists).toHaveBeenLastCalledWith("en", 2, "Luna");
  nodes = elements(render(artistId));
  const selected = nodes.find(
    (node) => node.props["className"] === "mc-wish-selected",
  );
  expect(
    elements(selected).find((node) => node.type === PhotoView)?.props["src"],
  ).toBe(image.url);
  const change = nodes.find(
    (node) => node.props["children"] === managementCopy("en").wishArtistChange,
  )!;
  (change.props["onClick"] as () => void)();
  expect(onChange).toHaveBeenLastCalledWith("");
  expect(
    elements(render()).some(
      (node) => node.props["className"] === "mc-wish-selected",
    ),
  ).toBe(false);
});

test("an already bound wish remains read-only and does not load alternative recipients", () => {
  const wish: WishGiftSummary = {
    schemaVersion: 1,
    wishId: "10000000-0000-4000-8000-000000000004",
    artistId: idolIdSchema.parse(artistId),
    artistName: "Mira",
    artistHandle: slugSchema.parse("mira"),
    status: "AVAILABLE",
  };
  const nodes = elements(render(artistId, "en", wish));
  hooks.effect?.();
  expect(wishArtists).not.toHaveBeenCalled();
  expect(
    nodes.some((node) => "data-management-wish-artist" in node.props),
  ).toBe(false);
  expect(nodes.some((node) => node.props["children"] === wish.artistName)).toBe(
    true,
  );
  expect(
    nodes.some(
      (node) =>
        node.props["children"] === managementCopy("en").wishArtistLocked,
    ),
  ).toBe(true);
});

test("only active published accepting artists can be selected without nesting a form", async () => {
  render();
  hooks.effect?.();
  await vi.waitFor(() => expect(hooks.values[5]).toBe(false));
  const nodes = elements(render());
  expect(nodes.some((node) => node.type === "form")).toBe(false);
  const options = nodes.filter(
    (node) => "data-management-wish-artist" in node.props,
  );
  expect(options).toHaveLength(2);
  expect(options[0]?.props["disabled"]).toBe(false);
  expect(options[1]?.props["disabled"]).toBe(true);
  (options[0]?.props["onClick"] as () => void)();
  expect(onChange).toHaveBeenCalledWith(artistId);
});

test("a failed search keeps the chosen recipient and permits retry", async () => {
  hooks.values = ["Mira", "Mira", 1, page, page.items[0], false, false, 0];
  wishArtists.mockRejectedValueOnce(new Error("Unavailable"));
  render(artistId);
  hooks.effect?.();
  await vi.waitFor(() => expect(hooks.values[6]).toBe(true));
  expect(hooks.values[4]).toBe(page.items[0]);
  expect(onChange).not.toHaveBeenCalled();
  const nodes = elements(render(artistId));
  expect(nodes.some((node) => node.props["role"] === "alert")).toBe(true);
  const retry = nodes.find(
    (node) => node.props["children"] === managementCopy("en").retry,
  )!;
  (retry.props["onClick"] as () => void)();
  render(artistId);
  hooks.effect?.();
  await vi.waitFor(() => expect(hooks.values[6]).toBe(false));
  await vi.waitFor(() => expect(hooks.values[5]).toBe(false));
  expect(hooks.values[4]).toBe(page.items[0]);
});

test("a replaced search cannot write its stale result after cleanup", async () => {
  let resolve!: (value: typeof page) => void;
  wishArtists.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render();
  const cleanup = hooks.effect?.();
  if (typeof cleanup === "function") cleanup();
  resolve(page);
  await Promise.resolve();
  await Promise.resolve();
  expect(hooks.values[3]).toBe(null);
});
