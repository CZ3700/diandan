import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ComponentProps } from "react";
import type * as BaseUiMenu from "@base-ui/react/menu";
import { expect, test, vi } from "vitest";
import { Menu } from "./menu.js";
import { LanguageControl } from "./selection-controls.js";

const observed = vi.hoisted(() => ({ open: undefined as boolean | undefined }));
// Observe the actual adapter boundary, forwarding every prop to the real primitive.
// SSR aria-expanded alone is insufficient: Base UI registers its trigger after mount.
vi.mock("@base-ui/react/menu", async (importOriginal) => {
  const actual = await importOriginal<typeof BaseUiMenu>();
  return {
    ...actual,
    Menu: {
      ...actual.Menu,
      Root: (props: ComponentProps<typeof actual.Menu.Root>) => {
        observed.open = props.open;
        return createElement(actual.Menu.Root, props);
      },
    },
  };
});

const menu = {
  label: "Choose language",
  value: "first",
  options: [{ label: "First", value: "first" }],
  onValueChange: () => undefined,
};

test("Menu accepts controlled open state for an asynchronously loaded first activation", () => {
  const props = { ...menu, open: true };
  renderToStaticMarkup(<Menu {...props} />);
  expect(observed.open).toBe(true);
});

test("LanguageControl forwards controlled open state without changing canonical options", () => {
  const props = {
    label: "Language",
    value: "en" as const,
    onValueChange: () => undefined,
    open: true,
  };
  const html = renderToStaticMarkup(<LanguageControl {...props} />);
  expect(observed.open).toBe(true);
  expect(html).toContain("English");
});

test("existing uncontrolled and explicitly closed callers remain closed initially", () => {
  renderToStaticMarkup(<Menu {...menu} />);
  expect(observed.open).toBe(false);
  const props = { ...menu, open: false };
  renderToStaticMarkup(<Menu {...props} />);
  expect(observed.open).toBe(false);
});
