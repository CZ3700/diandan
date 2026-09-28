import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import type * as React from "react";
import { informationFixture } from "./fixture";
import { AdminClientError } from "../workspace/client";
const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));
vi.mock("react", async (original) => ({
  ...(await original<typeof React>()),
  useCallback: (fn: unknown) => fn,
  useEffect: () => {},
  useLayoutEffect: (effect: () => unknown) => {
    effect();
  },
  useState: (initial: unknown) => {
    const i = hooks.index++;
    if (!(i in hooks.values))
      hooks.values[i] = typeof initial === "function" ? initial() : initial;
    return [
      hooks.values[i],
      (next: unknown) => {
        hooks.values[i] =
          typeof next === "function" ? next(hooks.values[i]) : next;
      },
    ];
  },
}));
const subject = await import("./workspace").catch(() => undefined);
const baseline = informationFixture();
const draft = {
  structure: baseline.draft!.structure,
  fields: { ...baseline.selected!.fields, title: "Changed" },
};
const review = vi.fn();
const save = vi.fn(),
  onDirtyChange = vi.fn(),
  onBusy = vi.fn();
const listener = new Map<string, (event: unknown) => void>();
function render() {
  expect(subject?.InformationPagesWorkspace).toBeTypeOf("function");
  hooks.index = 0;
  return subject!.InformationPagesWorkspace({
    api: {
      read: vi.fn(),
      history: vi.fn(),
      save,
      review,
      publish: vi.fn(),
      unpublish: vi.fn(),
      restore: vi.fn(),
    },
    locale: "zh-CN",
    localeScopes: ["en", "zh-CN"],
    onDirtyChange,
    onBusy,
  });
}
function find(
  node: unknown,
  key: string,
): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const result = find(child, key);
      if (result) return result;
    }
    return;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return;
  if (key in node.props) return node;
  return find(node.props["children"], key);
}
beforeEach(() => {
  vi.clearAllMocks();
  hooks.values = [
    "ABOUT",
    "en",
    baseline,
    draft,
    { structure: baseline.draft!.structure, fields: baseline.selected!.fields },
  ];
  listener.clear();
  vi.stubGlobal("window", {
    addEventListener: (key: string, fn: (e: unknown) => void) =>
      listener.set(key, fn),
    removeEventListener: () => {},
    confirm: () => false,
  });
});
afterEach(() => vi.unstubAllGlobals());
test("visible information edits immediately protect departure and never enter saved preview", () => {
  const tree = render();
  expect(onDirtyChange).toHaveBeenCalledWith(true);
  const prevent = vi.fn();
  listener.get("beforeunload")?.({ preventDefault: prevent });
  expect(prevent).toHaveBeenCalledOnce();
  expect(find(tree, "data-info-publish")?.props["disabled"]).toBe(true);
});
test("failed save keeps field edits and saved preview unchanged", async () => {
  save.mockRejectedValueOnce(new AdminClientError("CONTENT_UNAVAILABLE"));
  const tree = render();
  (find(tree, "data-info-form")!.props["onSubmit"] as (e: unknown) => void)({
    preventDefault: () => {},
  });
  await vi.waitFor(() => expect(onBusy).toHaveBeenLastCalledWith(false));
  expect(save).toHaveBeenCalledWith(baseline, draft);
  expect(hooks.values[3]).toBe(draft);
  expect(hooks.values[2]).toBe(baseline);
});

test("review submission announces review status and published drafts display their live status", async () => {
  hooks.values[3] = hooks.values[4];
  review.mockResolvedValueOnce({ ...baseline, version: 2 });
  const tree = render();
  (find(tree, "onSubmitReview")!.props["onSubmitReview"] as () => void)();
  await vi.waitFor(() => expect(onBusy).toHaveBeenLastCalledWith(false));
  expect(find(render(), "data-info-notice")?.props["children"]).toBe(
    translator("zh-CN")("inReview"),
  );
  hooks.values[2] = {
    ...baseline,
    published: {
      publicationId: "10000000-0000-4000-8000-000000000095",
      pageKey: "ABOUT",
      revisionId: baseline.draft!.revisionId,
      version: 2,
      action: "PUBLISH",
      restoredFromPublicationId: null,
      publishedAt: "2026-09-28T00:00:00Z",
    },
  };
  expect(find(render(), "data-info-dirty")?.props["children"]).toBe(
    informationCopy("zh-CN").live,
  );
});
import { translator } from "../workspace/components";
import { informationCopy } from "./copy";
