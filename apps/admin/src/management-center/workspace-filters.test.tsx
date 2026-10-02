import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isValidElement, type ComponentProps, type ReactElement } from "react";
import type * as React from "react";
import {
  managementCenterListItemSchema,
  managementCenterOperationSchema,
  managementCenterResponseSchema,
} from "@fan-support/contracts";
import type { ManagementApi, ManagementContext, ManagementList } from "./api";
import { ManagementGiftFilters, ManagementArtistSearch } from "./list-filters";
import { ManagementListView } from "./list-view";
import { ManagementEditor } from "./editor";
import { ManagementSelect } from "./form-fields";

// Exercise the workspace's real request and navigation callbacks without a browser server.
const hooks = vi.hoisted(() => ({
  values: [] as unknown[],
  refs: [] as { current: unknown }[],
  index: 0,
  refIndex: 0,
  effects: [] as { run: () => void | (() => void); deps: readonly unknown[] }[],
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof React>()),
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
  useRef: (initial: unknown) =>
    hooks.refs[hooks.refIndex++] ??
    (hooks.refs[hooks.refIndex - 1] = { current: initial }),
  useEffect: (run: () => void | (() => void), deps: readonly unknown[]) =>
    hooks.effects.push({ run, deps }),
  useLayoutEffect: () => {},
  useCallback: (callback: unknown) => callback,
}));
vi.mock("./focus", () => ({ scheduleManagementFocus: () => () => {} }));
const { ManagementWorkspace } = await import("./workspace");

const id = "10000000-0000-4000-8000-000000000001";
const gift = managementCenterListItemSchema.parse({
  kind: "GIFT",
  id,
  version: 1,
  sourceLocale: "en",
  name: "Gift",
  description: "Description",
  image: null,
  status: "active",
  handle: "test-gift",
  giftKind: "PHYSICAL",
  category: "OTHER",
  price: { market: "US", currency: "USD", amountMinor: 2300 },
  inventory: { policy: "PROCURE_ON_DEMAND" },
  eligibility: { rule: "ALL_ACTIVE_ARTISTS" },
  canEdit: true,
  inventoryPolicyLocked: false,
});
const context = managementCenterResponseSchema.parse({
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "CONTEXT",
  capability: "DIRECT_OPERATOR_V1",
  markets: [{ market: "US", currencies: ["USD"] }],
  defaults: {
    priceScope: { market: "US", currency: "USD" },
    inventoryPolicy: "PROCURE_ON_DEMAND",
    inventoryLocationId: null,
    eligibility: "ALL_ACTIVE_ARTISTS",
  },
  giftKinds: ["PHYSICAL", "VIRTUAL", "WISH", "MERCHANDISE"],
  categories: ["OTHER"],
  poster: { available: false, version: 0, currentRevisionId: null },
  operations: [],
  artists: { scope: "ALL", canAssign: false, brokers: [] },
}) as ManagementContext;
const page = (number = 1, total = 13): ManagementList => ({
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "LIST",
  section: "GIFTS",
  page: number,
  pageSize: 12,
  totalItems: total,
  items: Array.from(
    { length: Math.max(0, Math.min(12, total - (number - 1) * 12)) },
    (_, index) => ({
      ...gift,
      id: `10000000-0000-4000-8000-${String((number - 1) * 12 + index + 1).padStart(12, "0")}`,
    }),
  ),
});
const readList = vi.fn<ManagementApi["list"]>();
const api = {
  context: vi.fn(async () => context),
  list: readList,
  canDeleteGifts: async () => false,
} as unknown as ManagementApi;
let cleanup: (() => void) | void;
function render(initialSection: "GIFTS" | "ARTISTS" = "GIFTS") {
  hooks.index = 0;
  hooks.refIndex = 0;
  hooks.effects = [];
  return ManagementWorkspace({ api, locale: "en", initialSection });
}
function nodes(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...nodes(node.props["children"])];
}
function props<T extends React.ElementType>(
  tree: unknown,
  type: T,
): ComponentProps<T> {
  const found = nodes(tree).find((node) => node.type === type);
  expect(found).toBeDefined();
  return found!.props as ComponentProps<T>;
}
async function load() {
  cleanup?.();
  cleanup = hooks.effects
    .find(({ deps }) => deps[0] === api && typeof deps[1] === "string")!
    .run();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
beforeEach(() => {
  hooks.values = [];
  hooks.refs = [];
  cleanup = undefined;
  vi.clearAllMocks();
  readList.mockImplementation(async (_section, number) => page(number));
});
afterEach(() => {
  cleanup?.();
  vi.unstubAllGlobals();
});

it("retains kind, order and page across edit/back and saving existing content", async () => {
  render();
  await load();
  props(render(), ManagementGiftFilters).onKind("WISH");
  render();
  await load();
  props(render(), ManagementGiftFilters).onSort("PRICE_ASC");
  render();
  await load();
  props(render(), ManagementListView).onPage(2);
  render();
  await load();
  props(render(), ManagementListView).onSelect(gift);
  const back = nodes(render()).find(
    (node) => node.props["className"] === "mc-back",
  )!;
  (back.props["onClick"] as () => void)();
  render();
  await load();
  expect(readList).toHaveBeenLastCalledWith("GIFTS", 2, null, {
    giftKind: "WISH",
    sort: "PRICE_ASC",
  });
  props(render(), ManagementListView).onSelect(gift);
  props(render(), ManagementEditor).onPublished(
    managementCenterOperationSchema.parse({
      operationId: id,
      version: 1,
      kind: "SAVE_GIFT",
      sourceLocale: "en",
      status: "PUBLISHED",
      targetId: id,
      updatedAt: "2026-10-02T00:00:00Z",
      failure: null,
      result: {
        targetId: id,
        handle: "test-gift",
        revisionId: id,
        publicationId: id,
        version: 2,
      },
    }),
  );
  render();
  await load();
  expect(readList).toHaveBeenLastCalledWith("GIFTS", 2, null, {
    giftKind: "WISH",
    sort: "PRICE_ASC",
  });
});
it("resets only pagination on a new filter and clamps an emptied last page", async () => {
  render();
  await load();
  props(render(), ManagementListView).onPage(2);
  render();
  await load();
  props(render(), ManagementGiftFilters).onKind("VIRTUAL");
  render();
  await load();
  expect(readList).toHaveBeenLastCalledWith("GIFTS", 1, null, {
    giftKind: "VIRTUAL",
    sort: "NEWEST",
  });
  props(render(), ManagementListView).onPage(2);
  readList.mockResolvedValueOnce(page(2, 12));
  render();
  await load();
  render();
  await load();
  expect(readList).toHaveBeenLastCalledWith("GIFTS", 1, null, {
    giftKind: "VIRTUAL",
    sort: "NEWEST",
  });
});
it("ignores an older response after another filter wins", async () => {
  render();
  await load();
  const stale = Promise.withResolvers<ManagementList>();
  readList.mockReturnValueOnce(stale.promise);
  props(render(), ManagementGiftFilters).onKind("VIRTUAL");
  render();
  await load();
  expect(props(render(), ManagementListView).busy).toBe(true);
  props(render(), ManagementGiftFilters).onKind("WISH");
  readList.mockResolvedValueOnce(page(1, 1));
  render();
  await load();
  stale.resolve(page(1, 12));
  await Promise.resolve();
  await Promise.resolve();
  expect(props(render(), ManagementListView).list.totalItems).toBe(1);
  expect(props(render(), ManagementGiftFilters).kind).toBe("WISH");
});
it("retries a failed query without losing its filters", async () => {
  render();
  await load();
  props(render(), ManagementGiftFilters).onKind("PHYSICAL");
  readList.mockRejectedValueOnce(new Error("test list unavailable"));
  render();
  await load();
  const retry = nodes(render()).find(
    (node) => node.props["children"] === "Reload list",
  )!;
  expect(retry).toBeDefined();
  (retry.props["onClick"] as () => void)();
  render();
  await load();
  expect(readList).toHaveBeenLastCalledWith("GIFTS", 1, null, {
    giftKind: "PHYSICAL",
    sort: "NEWEST",
  });
});
it("combines artist search and assignment while keeping draft typing out of the request", async () => {
  readList.mockResolvedValue({ ...page(1, 0), section: "ARTISTS" });
  render("ARTISTS");
  await load();
  props(render("ARTISTS"), ManagementSelect).onChange("UNASSIGNED");
  render("ARTISTS");
  await load();
  props(render("ARTISTS"), ManagementArtistSearch).onChange("Mira");
  expect(readList).toHaveBeenLastCalledWith(
    "ARTISTS",
    1,
    { kind: "UNASSIGNED" },
    { search: "" },
  );
  props(render("ARTISTS"), ManagementArtistSearch).onSearch("Mira");
  render("ARTISTS");
  await load();
  expect(readList).toHaveBeenLastCalledWith(
    "ARTISTS",
    1,
    { kind: "UNASSIGNED" },
    { search: "Mira" },
  );
});
it("keeps dirty edits open when leaving is declined", async () => {
  render();
  await load();
  props(render(), ManagementListView).onSelect(gift);
  props(render(), ManagementEditor).onDirtyChange?.(true);
  const confirm = vi.fn(() => false);
  vi.stubGlobal("window", { confirm });
  const back = nodes(render()).find(
    (node) => node.props["className"] === "mc-back",
  )!;
  (back.props["onClick"] as () => void)();
  expect(confirm).toHaveBeenCalledOnce();
  expect(props(render(), ManagementEditor).selection.item?.id).toBe(gift.id);
});
