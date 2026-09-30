import { Children, isValidElement, type ReactNode } from "react";
import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import type { PublishedMediaView } from "@fan-support/contracts";

const state = vi.hoisted(() => ({ failedIdentity: null as string | null }));
vi.mock("react", async (load) => ({
  ...(await load<typeof React>()),
  useState: () => [
    state.failedIdentity,
    (next: string | null) => {
      state.failedIdentity = next;
    },
  ],
  useEffect: () => {},
  useRef: () => ({ current: null }),
}));
import { PublishedHeroImage } from "./published-image";

const media = {
  schemaVersion: 1,
  kind: "INFORMATIVE",
  url: "https://media.example.invalid/hero.webp",
  alt: "Group portrait",
  width: 2400,
  height: 1350,
  focalPoint: { x: 0.5, y: 0.5 },
} as PublishedMediaView;

function imageError(node: ReactNode): (() => void) | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode; onError?: () => void }>(child))
      continue;
    if (child.type === "img") return child.props.onError;
    const nested = imageError(child.props.children);
    if (nested) return nested;
  }
  return undefined;
}

beforeEach(() => {
  state.failedIdentity = null;
});

test("a failed photograph removes its decorative layer and pause control", () => {
  const render = (source = media) =>
    PublishedHeroImage({
      desktop: source,
      mobile: source,
      fallbackLabel: "Image unavailable",
      children: <button type="button">Pause motion</button>,
    });
  const error = imageError(render());
  expect(error).toBeTypeOf("function");
  error?.();
  const failed = renderToStaticMarkup(render());
  expect(failed).toContain("Image unavailable");
  expect(failed).not.toContain("Pause motion");
  expect(failed).not.toContain("<picture>");
  const replacement = renderToStaticMarkup(
    render({
      ...media,
      url: "https://media.example.invalid/replacement.webp" as PublishedMediaView["url"],
    }),
  );
  expect(replacement).toContain("Pause motion");
  expect(replacement).toContain("<picture>");
});
