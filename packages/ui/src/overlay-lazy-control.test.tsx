import { createRef, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type * as BaseUiDialog from "@base-ui/react/dialog";
import { expect, test, vi } from "vitest";
import { Drawer } from "./overlay.js";

const observed = vi.hoisted(() => ({
  trigger: undefined as unknown,
  root: undefined as unknown,
  popup: undefined as unknown,
}));
vi.mock("@base-ui/react/dialog", async (load) => {
  const actual = await load<typeof BaseUiDialog>();
  return {
    ...actual,
    Dialog: {
      ...actual.Dialog,
      Root: (props: Record<string, unknown>) => {
        observed.root = props;
        return <actual.Dialog.Root {...props} />;
      },
      Trigger: (props: Record<string, unknown>) => {
        observed.trigger = props;
        return <actual.Dialog.Trigger {...props} />;
      },
      // Expose the popup prop boundary during SSR without pretending this is a DOM-focus test.
      Portal: ({ children }: { children: ReactNode }) => children,
      Viewport: ({ children }: { children: ReactNode }) => children,
      Popup: (props: Record<string, unknown>) => {
        observed.popup = props;
        return null;
      },
    },
  };
});

const copy = {
  title: "Fixture title",
  description: "Fixture description",
  triggerLabel: "Open",
  closeLabel: "Close",
};

test("a deferred drawer can bind the replacement trigger to its controlled Root", () => {
  renderToStaticMarkup(
    <Drawer
      {...copy}
      open={false}
      triggerRef={createRef<HTMLButtonElement>()}
    />,
  );
  const trigger = observed.trigger as Record<string, unknown>;
  const root = observed.root as Record<string, unknown>;
  expect(trigger["ref"]).toBeDefined();
  expect(root["triggerId"]).toBeDefined();
  expect(trigger["id"]).toBe(root["triggerId"]);
});

test("first touch opening can preserve popup focus instead of focusing a form field", () => {
  renderToStaticMarkup(<Drawer {...copy} open initialFocus="popup" />);
  const popup = observed.popup as Record<string, unknown>;
  expect(popup["initialFocus"]).toBeDefined();
  expect(popup["initialFocus"]).toBe(popup["ref"]);
});

test("legacy Drawer defaults still leave initial-focus choice to the original primitive", () => {
  renderToStaticMarkup(<Drawer {...copy} />);
  expect((observed.root as Record<string, unknown>)["open"]).toBeUndefined();
  expect(
    (observed.popup as Record<string, unknown>)["initialFocus"],
  ).toBeUndefined();
});
