import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import type * as React from "react";
import { AdminClientError } from "../workspace/client";
const hooks = vi.hoisted(() => ({
  values: [] as unknown[],
  refs: [] as { current: unknown }[],
  index: 0,
  refIndex: 0,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof React>()),
  useCallback: (fn: unknown) => fn,
  useEffect: () => {},
  useLayoutEffect: (fn: () => void) => fn(),
  useRef: (initial: unknown) => {
    const index = hooks.refIndex++;
    return (hooks.refs[index] ??= { current: initial });
  },
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values))
      hooks.values[index] = typeof initial === "function" ? initial() : initial;
    return [
      hooks.values[index],
      (next: unknown) =>
        (hooks.values[index] =
          typeof next === "function" ? next(hooks.values[index]) : next),
    ];
  },
}));
const subject = await import("./brand-workspace").catch(() => undefined);
const id = "10000000-0000-4000-8000-000000000001";
const logo = {
  assetId: id,
  url: "https://cdn.example.test/processed/v1/10000000-0000-4000-8000-000000000001/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp",
  width: 320,
  height: 80,
};
const baseline = { schemaVersion: 1 as const, lightLogo: null, darkLogo: null };
const view = { ...baseline, lightLogo: logo };
const saved = {
  schemaVersion: 1 as const,
  version: 1,
  draft: {
    revisionId: id,
    createdAt: "2026-10-01T00:00:00Z",
    view: baseline,
    brand: {
      schemaVersion: 1 as const,
      lightLogoAssetId: null,
      darkLogoAssetId: null,
    },
  },
  published: null,
};
const api = {
  read: vi.fn(),
  history: vi.fn(),
  save: vi.fn(),
  publish: vi.fn(),
  restore: vi.fn(),
  upload: vi.fn(),
};
const onBusy = vi.fn(),
  onDirtyChange = vi.fn();
function find(
  node: unknown,
  key: string,
): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, key);
      if (found) return found;
    }
    return;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return;
  if (key in node.props) return node;
  return find(node.props["children"], key);
}
function render(canUpload = true) {
  hooks.index = 0;
  hooks.refIndex = 0;
  expect(subject?.BrandWorkspace).toBeTypeOf("function");
  return subject!.BrandWorkspace({
    api,
    locale: "zh-CN",
    canEdit: true,
    canPublish: true,
    canUpload,
    onBusy,
    onDirtyChange,
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  hooks.values = [saved, view];
  hooks.refs = [];
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    confirm: () => false,
  });
});
afterEach(() => vi.unstubAllGlobals());
test.each(["CONTENT_UNAVAILABLE", "STALE_VERSION"])(
  "%s keeps both logo changes and only clears dirty after successful save",
  async (code) => {
    let tree = render();
    api.save.mockRejectedValueOnce(new AdminClientError(code));
    (find(tree, "data-brand-save")!.props["onClick"] as () => void)();
    await vi.waitFor(() => expect(onBusy).toHaveBeenLastCalledWith(false));
    expect(hooks.values[1]).toBe(view);
    tree = render();
    expect(find(tree, "data-brand-dirty")!.props["data-brand-dirty"]).toBe(
      true,
    );
    expect(find(tree, "data-brand-publish")!.props["disabled"]).toBe(true);
    api.save.mockResolvedValueOnce({
      ...saved,
      version: 2,
      draft: {
        ...saved.draft,
        view,
        brand: {
          schemaVersion: 1,
          lightLogoAssetId: id,
          darkLogoAssetId: null,
        },
      },
    });
    (find(tree, "data-brand-save")!.props["onClick"] as () => void)();
    await vi.waitFor(() =>
      expect(hooks.values[0]).toMatchObject({ version: 2 }),
    );
    tree = render();
    expect(find(tree, "data-brand-dirty")!.props["data-brand-dirty"]).toBe(
      false,
    );
  },
);
test("an unavailable preview does not silently remove a saved logo reference", () => {
  const stored = {
    ...saved,
    draft: {
      ...saved.draft,
      brand: {
        schemaVersion: 1 as const,
        lightLogoAssetId: id,
        darkLogoAssetId: null,
      },
    },
  };
  hooks.values = [stored, baseline];
  // The edit model retains authority even if the read-only media projection is unavailable.
  hooks.values[14] = stored.draft.brand;
  const tree = render();
  expect(find(tree, "data-brand-dirty")!.props["data-brand-dirty"]).toBe(false);
});
test("failed logo preparation preserves the chosen file and blocks saving stale preview; missing upload permission never calls the API", async () => {
  let tree = render(false);
  const file = new File(["logo"], "logo.png", { type: "image/png" });
  (
    find(tree, "onUpload")!.props["onUpload"] as (
      slot: string,
      file: File,
    ) => void
  )("darkLogo", file);
  expect(api.upload).not.toHaveBeenCalled();
  tree = render();
  api.upload.mockRejectedValueOnce(new Error("prepare unavailable"));
  (
    find(tree, "onUpload")!.props["onUpload"] as (
      slot: string,
      file: File,
    ) => void
  )("darkLogo", file);
  await vi.waitFor(() => expect(api.upload).toHaveBeenCalledOnce());
  await vi.waitFor(() => expect(onBusy).toHaveBeenLastCalledWith(false));
  tree = render();
  expect(find(tree, "files")!.props["files"]).toEqual({ darkLogo: file });
  expect(find(tree, "view")!.props["view"]).toBe(view);
  expect(find(tree, "data-brand-save")!.props["disabled"]).toBe(true);
});
test("a new store does not claim a logo has been published", () => {
  hooks.values = [
    { schemaVersion: 1, version: 0, draft: null, published: null },
    baseline,
  ];
  const tree = render();
  expect(find(tree, "data-brand-dirty")!.props["children"]).toBe(
    "尚未设置品牌标识",
  );
});
test("cancelling a failed selection keeps the existing ready logo and clears pending state", () => {
  hooks.values[11] = {
    lightLogo: new File(["new"], "new.png", { type: "image/png" }),
  };
  hooks.values[12] = { lightLogo: "prepare failed" };
  let tree = render();
  const cancel = find(tree, "onCancelUpload")?.props["onCancelUpload"];
  expect(cancel).toBeTypeOf("function");
  (cancel as (slot: string) => void)("lightLogo");
  tree = render();
  expect(find(tree, "files")!.props["files"]).toEqual({});
  expect(find(tree, "view")!.props["view"]).toBe(view);
  expect(find(tree, "data-brand-save")!.props["disabled"]).toBe(false);
});
