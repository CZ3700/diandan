import { isValidElement, type ReactElement } from "react";
import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import en from "../../../../packages/i18n/src/storefront/en";

type Playback = "idle" | "playing" | "paused";
const state = vi.hoisted(() => ({
  playback: "idle" as Playback,
  mount: undefined as (() => void) | undefined,
}));
vi.mock("react", async (load) => ({
  ...(await load<typeof React>()),
  useState: () => [
    state.playback,
    (next: Playback | ((current: Playback) => Playback)) => {
      state.playback = typeof next === "function" ? next(state.playback) : next;
    },
  ],
  useEffect: (mount: () => void) => {
    state.mount = mount;
  },
}));
import { HeroMotion } from "./hero-motion";

beforeEach(() => {
  state.playback = "idle";
  state.mount = undefined;
});

test("pause and play change only decorative playback and the button's next action", () => {
  const render = () => HeroMotion({ copy: en });
  const button = (view: ReturnType<typeof render>) => {
    const result = view.props.children[1];
    if (!isValidElement(result)) throw new Error("Missing motion control");
    return result as ReactElement<{ onClick: () => void }>;
  };
  expect(render().props["data-hero-motion"]).toBe("idle");
  state.mount?.();
  const playing = render();
  expect(playing.props["data-hero-motion"]).toBe("playing");
  expect(renderToStaticMarkup(playing)).toContain(en.heroPauseMotion);
  button(playing).props.onClick();
  const paused = render();
  expect(paused.props["data-hero-motion"]).toBe("paused");
  expect(renderToStaticMarkup(paused)).toContain(en.heroPlayMotion);
  expect(renderToStaticMarkup(paused)).not.toContain("<img");
  button(paused).props.onClick();
  expect(render().props["data-hero-motion"]).toBe("playing");
});

test("server markup is deterministic and needs no browser preference or random values", () => {
  const first = renderToStaticMarkup(<HeroMotion copy={en} />);
  expect(first).toBe(renderToStaticMarkup(<HeroMotion copy={en} />));
  expect(first).toContain('data-hero-motion="idle"');
  expect(first).toContain('type="button"');
  expect(first).toContain('aria-hidden="true"');
  expect(first).not.toContain("tabindex=");
});
