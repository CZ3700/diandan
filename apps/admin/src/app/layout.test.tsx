import { isValidElement, type ReactElement } from "react";
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
  expect(subject.metadata.formatDetection).toEqual({
    telephone: false,
    date: false,
    email: false,
    address: false,
  });
  const html = (await subject.default({
    children: null,
  })) as ReactElement<ElementProps>;
  expect(html.type).toBe("html");
  expect(html.props.lang).toBe("th");
  expect(html.props.suppressHydrationWarning).toBe(true);
  const body = html.props.children;
  expect(isValidElement(body)).toBe(true);
  expect((body as ReactElement<ElementProps>).type).toBe("body");
  expect(
    (body as ReactElement<ElementProps>).props.suppressHydrationWarning,
  ).toBe(true);
}, 30_000);
