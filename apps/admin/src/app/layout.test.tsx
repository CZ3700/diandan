import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { expect, test, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-admin-locale": "th" }),
}));

type ElementProps = Readonly<{
  children?: unknown;
  lang?: string;
  suppressHydrationWarning?: boolean;
}>;

// The first import compiles the whole layout module graph, which is slow under parallel
// turbo load; the assertions themselves are synchronous.
test("keeps phone browsers from rewriting admin HTML before hydration", async () => {
  const subject = await import("./layout");
  // Streaming metadata appends <meta> after the body content, too late for iOS, so the
  // format-detection switch is written into <head> itself and not through `metadata`.
  expect(subject.metadata.formatDetection).toBeUndefined();
  const html = (await subject.default({
    children: null,
  })) as ReactElement<ElementProps>;
  expect(html.type).toBe("html");
  expect(html.props.lang).toBe("th");
  expect(html.props.suppressHydrationWarning).toBe(true);
  const [head, body] = Children.toArray(
    html.props.children as ReactNode,
  ) as Array<ReactElement<ElementProps>>;
  expect(head?.type).toBe("head");
  expect(
    Children.toArray(head?.props.children as ReactNode).map(
      (meta) =>
        (meta as ReactElement<{ name?: string; content?: string }>).props,
    ),
  ).toContainEqual({
    name: "format-detection",
    content: "telephone=no, date=no, email=no, address=no",
  });
  expect(isValidElement(body)).toBe(true);
  expect((body as ReactElement<ElementProps>).type).toBe("body");
  expect(
    (body as ReactElement<ElementProps>).props.suppressHydrationWarning,
  ).toBe(true);
}, 30_000);
