import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import type * as React from "react";
import { createDefaultStorefrontTheme } from "@fan-support/contracts";

const hooks = vi.hoisted(() => ({
  values: [] as unknown[],
  index: 0,
  refIndex: 0,
  refs: [] as { current: unknown }[],
  effects: [] as (() => unknown)[],
}));
vi.mock("react", async (original) => {
  const react = await original<typeof React>();
  return {
    ...react,
    useRef: () => {
      const index = hooks.refIndex++;
      hooks.refs[index] ??= { current: null };
      return hooks.refs[index];
    },
    useEffect: (effect: () => unknown) => hooks.effects.push(effect),
    useState: (initial: unknown) => {
      const index = hooks.index++;
      if (!(index in hooks.values))
        hooks.values[index] =
          typeof initial === "function" ? initial() : initial;
      return [
        hooks.values[index],
        (next: unknown) => {
          hooks.values[index] =
            typeof next === "function" ? next(hooks.values[index]) : next;
        },
      ];
    },
  };
});
import { ThemePreviewFrame } from "./preview-frame";
import * as previews from "./preview-frame";
import { navigationFixture } from "./navigation-fixture";
const navigationLabels = await import("./navigation-copy").catch(
  () => undefined,
);
import { themeCopy } from "./theme-copy";

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
function renderFrame(theme = createDefaultStorefrontTheme()) {
  hooks.index = 0;
  hooks.refIndex = 0;
  hooks.effects = [];
  const copy = themeCopy("zh-CN");
  const frame = ThemePreviewFrame({
    theme,
    locale: "zh-CN",
    origin: "https://storefront.example.invalid",
    copy,
    replayLabel: copy.replayPreview,
    pageCopy: copy.previewPages,
  }) as ReactElement<Record<string, unknown>>;
  return (frame.type as (props: typeof frame.props) => ReactElement)(
    frame.props,
  );
}
function changePage(tree: ReactElement, value: string) {
  const picker = find(tree, "data-theme-preview-page");
  expect(picker).toBeDefined();
  (picker!.props["onChange"] as (event: unknown) => void)({
    currentTarget: { value },
  });
}
function frameUrl(tree: ReactElement) {
  const frame = find(tree, "data-theme-preview-frame");
  expect(frame).toBeDefined();
  return new URL(String(frame!.props["src"]));
}
beforeEach(() => {
  hooks.values = [];
  hooks.refs = [];
  hooks.refIndex = 0;
  hooks.index = 0;
  hooks.effects = [];
});
test("switching preview pages creates a new channel without changing the supplied draft or viewport", () => {
  const theme = {
    ...createDefaultStorefrontTheme(),
    detailTemplates: { artist: "SPLIT" as const, gift: "IMAGE_RIGHT" as const },
  };
  const unchanged = structuredClone(theme);
  renderFrame(theme);
  hooks.effects[0]!();
  let tree = renderFrame(theme);
  const home = frameUrl(tree);
  expect(home.searchParams.get("page")).toBeNull();
  changePage(tree, "artist");
  tree = renderFrame(theme);
  const artist = frameUrl(tree);
  expect(artist.searchParams.get("page")).toBe("artist");
  expect(artist.searchParams.get("channel")).not.toBe(
    home.searchParams.get("channel"),
  );
  expect(
    find(tree, "data-preview-viewport")?.props["data-preview-viewport"],
  ).toBe("mobile");
  changePage(tree, "gift");
  tree = renderFrame(theme);
  const gift = frameUrl(tree);
  expect(gift.searchParams.get("page")).toBe("gift");
  expect(gift.searchParams.get("channel")).not.toBe(
    artist.searchParams.get("channel"),
  );
  expect(theme).toEqual(unchanged);
  changePage(tree, "https://untrusted.example");
  expect(frameUrl(renderFrame(theme)).href).toBe(gift.href);
});
test("replay reloads the current detail page and returning home clears its page query", () => {
  renderFrame();
  hooks.effects[0]!();
  let tree = renderFrame();
  changePage(tree, "gift");
  tree = renderFrame();
  const gift = frameUrl(tree);
  const replay = find(tree, "data-theme-preview-replay");
  expect(replay).toBeDefined();
  (replay!.props["onClick"] as () => void)();
  tree = renderFrame();
  const replayed = frameUrl(tree);
  expect(replayed.searchParams.get("page")).toBe("gift");
  expect(replayed.searchParams.get("channel")).not.toBe(
    gift.searchParams.get("channel"),
  );
  changePage(tree, "home");
  const home = frameUrl(renderFrame());
  expect(home.searchParams.get("page")).toBeNull();
  expect(home.searchParams.get("channel")).not.toBe(
    replayed.searchParams.get("channel"),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
test("a delayed old ready event cannot publish the draft to a newly selected preview page", () => {
  vi.useFakeTimers();
  const receive: ((event: unknown) => void)[] = [];
  vi.stubGlobal("window", {
    addEventListener: (_type: string, listener: (event: unknown) => void) =>
      receive.push(listener),
    removeEventListener: () => {},
  });
  const theme = {
    ...createDefaultStorefrontTheme(),
    detailTemplates: { artist: "SPLIT" as const, gift: "IMAGE_RIGHT" as const },
  };
  const contentWindow = { postMessage: vi.fn() };
  function renderConnected() {
    const tree = renderFrame(theme);
    const frame = find(tree, "data-theme-preview-frame");
    expect(frame).toBeDefined();
    (frame!.props["ref"] as { current: unknown }).current = { contentWindow };
    return tree;
  }
  renderFrame(theme);
  hooks.effects[0]!();
  let tree = renderConnected();
  const home = frameUrl(tree);
  hooks.effects[2]!();
  const message = (
    channel: string | null,
    origin = home.origin,
    source: unknown = contentWindow,
  ) => ({
    origin,
    source,
    data: { schemaVersion: 1, type: "STOREFRONT_THEME_PREVIEW_READY", channel },
  });
  receive[0]!(message(home.searchParams.get("channel")));
  tree = renderConnected();
  hooks.effects[3]!();
  expect(contentWindow.postMessage).toHaveBeenCalledExactlyOnceWith(
    {
      schemaVersion: 1,
      type: "STOREFRONT_THEME_PREVIEW",
      channel: home.searchParams.get("channel"),
      theme,
    },
    home.origin,
  );
  changePage(tree, "gift");
  tree = renderConnected();
  const gift = frameUrl(tree);
  // The old listener may still be queued before React cleans it up.
  receive[0]!(message(home.searchParams.get("channel")));
  renderConnected();
  hooks.effects[3]!();
  expect(contentWindow.postMessage).toHaveBeenCalledTimes(1);
  hooks.effects[2]!();
  receive[1]!(message(home.searchParams.get("channel")));
  receive[1]!(
    message(gift.searchParams.get("channel"), "https://other.example.invalid"),
  );
  receive[1]!(message(gift.searchParams.get("channel"), gift.origin, {}));
  renderConnected();
  hooks.effects[3]!();
  expect(contentWindow.postMessage).toHaveBeenCalledTimes(1);
  receive[1]!(message(gift.searchParams.get("channel")));
  renderConnected();
  hooks.effects[3]!();
  expect(contentWindow.postMessage).toHaveBeenLastCalledWith(
    {
      schemaVersion: 1,
      type: "STOREFRONT_THEME_PREVIEW",
      channel: gift.searchParams.get("channel"),
      theme,
    },
    gift.origin,
  );
  expect(contentWindow.postMessage).toHaveBeenCalledTimes(2);
});

test("navigation preview views replace the channel and keep current configuration and viewport", () => {
  expect(previews.NavigationPreviewFrame).toBeTypeOf("function");
  expect(navigationLabels?.navigationCopy).toBeTypeOf("function");
  const navigation = navigationFixture();
  function render() {
    hooks.index = 0;
    hooks.refIndex = 0;
    hooks.effects = [];
    const copy = navigationLabels!.navigationCopy("zh-CN");
    const wrapper = previews.NavigationPreviewFrame({
      navigation,
      locale: "zh-CN",
      origin: "https://storefront.example.invalid",
      copy,
      viewCopy: copy.previewViews,
    }) as ReactElement<Record<string, unknown>>;
    return (wrapper.type as (props: typeof wrapper.props) => ReactElement)(
      wrapper.props,
    );
  }
  render();
  hooks.effects[0]!();
  let tree = render();
  let prior = new URL(
    String(find(tree, "data-navigation-preview-frame")?.props["src"]),
  );
  expect(prior.searchParams.get("mode")).toBe("navigation");
  expect(prior.searchParams.get("view")).toBeNull();
  for (const view of ["menu", "footer", "header"]) {
    const select = find(tree, "data-navigation-preview-view");
    expect(select).toBeDefined();
    (select!.props["onChange"] as (event: unknown) => void)({
      currentTarget: { value: view },
    });
    tree = render();
    const next = new URL(
      String(find(tree, "data-navigation-preview-frame")?.props["src"]),
    );
    expect(next.searchParams.get("view")).toBe(view === "header" ? null : view);
    expect(next.searchParams.get("channel")).not.toBe(
      prior.searchParams.get("channel"),
    );
    expect(
      find(tree, "data-preview-viewport")?.props["data-preview-viewport"],
    ).toBe("mobile");
    prior = next;
  }
  expect(navigation).toEqual(navigationFixture());
});

test("navigation preview rejects wrong origin, source, channel and stale view readiness", () => {
  vi.useFakeTimers();
  const receive: ((event: unknown) => void)[] = [];
  vi.stubGlobal("window", {
    addEventListener: (_type: string, listener: (event: unknown) => void) =>
      receive.push(listener),
    removeEventListener: () => {},
  });
  const navigation = navigationFixture();
  function renderNavigation() {
    hooks.index = 0;
    hooks.refIndex = 0;
    hooks.effects = [];
    const copy = navigationLabels!.navigationCopy("zh-CN");
    const wrapper = previews.NavigationPreviewFrame({
      navigation,
      locale: "zh-CN",
      origin: "https://storefront.example.invalid",
      copy,
      viewCopy: copy.previewViews,
    }) as ReactElement<Record<string, unknown>>;
    return (wrapper.type as (props: typeof wrapper.props) => ReactElement)(
      wrapper.props,
    );
  }
  function url(tree: ReactElement) {
    return new URL(
      String(find(tree, "data-navigation-preview-frame")?.props["src"]),
    );
  }
  const contentWindow = { postMessage: vi.fn() };
  function renderConnected() {
    const tree = renderNavigation();
    const frame = find(tree, "data-navigation-preview-frame");
    expect(frame).toBeDefined();
    (frame!.props["ref"] as { current: unknown }).current = { contentWindow };
    return tree;
  }
  renderNavigation();
  hooks.effects[0]!();
  let tree = renderConnected();
  const home = url(tree);
  hooks.effects[2]!();
  const message = (
    channel: string | null,
    origin = home.origin,
    source: unknown = contentWindow,
  ) => ({
    origin,
    source,
    data: {
      schemaVersion: 1,
      type: "STOREFRONT_NAVIGATION_PREVIEW_READY",
      channel,
    },
  });
  receive[0]!(message(home.searchParams.get("channel")));
  tree = renderConnected();
  hooks.effects[3]!();
  expect(contentWindow.postMessage).toHaveBeenCalledExactlyOnceWith(
    {
      schemaVersion: 1,
      type: "STOREFRONT_NAVIGATION_PREVIEW",
      channel: home.searchParams.get("channel"),
      navigation,
    },
    home.origin,
  );
  (
    find(tree, "data-navigation-preview-view")!.props["onChange"] as (
      event: unknown,
    ) => void
  )({ currentTarget: { value: "footer" } });
  tree = renderConnected();
  const gift = url(tree);
  // The old listener may still be queued before React cleans it up.
  receive[0]!(message(home.searchParams.get("channel")));
  renderConnected();
  hooks.effects[3]!();
  expect(contentWindow.postMessage).toHaveBeenCalledTimes(1);
  hooks.effects[2]!();
  receive[1]!(message(home.searchParams.get("channel")));
  receive[1]!(
    message(gift.searchParams.get("channel"), "https://other.example.invalid"),
  );
  receive[1]!(message(gift.searchParams.get("channel"), gift.origin, {}));
  renderConnected();
  hooks.effects[3]!();
  expect(contentWindow.postMessage).toHaveBeenCalledTimes(1);
  receive[1]!(message(gift.searchParams.get("channel")));
  renderConnected();
  hooks.effects[3]!();
  expect(contentWindow.postMessage).toHaveBeenLastCalledWith(
    {
      schemaVersion: 1,
      type: "STOREFRONT_NAVIGATION_PREVIEW",
      channel: gift.searchParams.get("channel"),
      navigation,
    },
    gift.origin,
  );
  expect(contentWindow.postMessage).toHaveBeenCalledTimes(2);
});

import { informationFixture } from "../management-info-pages/fixture";
import { informationCopy } from "../management-info-pages/copy";
test("information frame uses content locale and sends only saved public document after exact readiness", () => {
  vi.useFakeTimers();
  const receive: ((event: unknown) => void)[] = [];
  vi.stubGlobal("window", {
    addEventListener: (_key: string, listener: (event: unknown) => void) =>
      receive.push(listener),
    removeEventListener: () => {},
  });
  const document = informationFixture().preview!;
  const contentWindow = { postMessage: vi.fn() };
  function render() {
    hooks.index = 0;
    hooks.refIndex = 0;
    hooks.effects = [];
    const wrapper = previews.InformationPreviewFrame({
      document,
      locale: "zh-CN",
      origin: "https://storefront.example.invalid",
      copy: informationCopy("zh-CN"),
    });
    const inner = find(wrapper, "configuration")!;
    return (inner.type as (props: typeof inner.props) => ReactElement)(
      inner.props,
    );
  }
  render();
  hooks.effects[0]!();
  const tree = render();
  const frame = find(tree, "data-info-preview-frame")!;
  (frame.props["ref"] as { current: unknown }).current = { contentWindow };
  const url = new URL(String(frame.props["src"]));
  expect(url.pathname).toBe("/en/information-preview");
  expect(url.searchParams.get("page")).toBe("about");
  hooks.effects[2]!();
  const message = (
    origin = url.origin,
    source: unknown = contentWindow,
    channel = url.searchParams.get("channel"),
  ) => ({
    origin,
    source,
    data: { schemaVersion: 1, type: "INFORMATION_PAGE_PREVIEW_READY", channel },
  });
  receive[0]!(message("https://other.example.invalid"));
  receive[0]!(message(url.origin, {}));
  receive[0]!(
    message(url.origin, contentWindow, "10000000-0000-4000-8000-000000000093"),
  );
  render();
  hooks.effects[3]!();
  expect(contentWindow.postMessage).not.toHaveBeenCalled();
  receive[0]!(message());
  render();
  hooks.effects[3]!();
  expect(contentWindow.postMessage).toHaveBeenCalledExactlyOnceWith(
    {
      schemaVersion: 1,
      type: "INFORMATION_PAGE_PREVIEW_RENDER",
      channel: url.searchParams.get("channel"),
      document,
    },
    url.origin,
  );
});
