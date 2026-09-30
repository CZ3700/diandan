import { beforeEach, expect, test, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import type * as React from "react";
import { adminCatalogResponseSchema } from "@fan-support/contracts";
import { managementCopy } from "./copy";

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
function render(value = "") {
  hooks.index = 0;
  return WishArtistPicker({
    api: { wishArtists },
    locale: "en",
    copy: managementCopy("en"),
    value,
    wish: undefined,
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
