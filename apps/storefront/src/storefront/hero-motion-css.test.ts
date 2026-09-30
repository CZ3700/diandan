import { readFile } from "node:fs/promises";
import postcss from "postcss";
import { expect, test } from "vitest";

const stylesheet = () =>
  readFile(new URL("./hero-motion.css", import.meta.url), "utf8");

test("every photo effect inherits pause state without an animation shorthand resetting it", async () => {
  const sheet = postcss.parse(await stylesheet());
  const playStates: string[] = [];
  sheet.walkRules((rule) => {
    if (rule.selector === "[data-hero-layer] > span") {
      rule.walkDecls("animation-play-state", (declaration) => {
        playStates.push(declaration.value);
      });
    }
    if (rule.selector.includes("[data-hero-layer")) {
      rule.walkDecls("animation", () => {
        throw new Error("A shorthand would reset the inherited pause state");
      });
    }
  });
  expect(playStates).toEqual(["var(--hero-play-state, running)"]);
  expect(await stylesheet()).toContain(
    '[data-hero-motion="paused"] {\n  --hero-play-state: paused;',
  );
});

test("decorative keyframes stay on compositor properties and no effect transforms the photograph", async () => {
  const sheet = postcss.parse(await stylesheet());
  let keyframes = 0;
  sheet.walkAtRules("keyframes", (rule) => {
    keyframes++;
    rule.walkDecls((declaration) =>
      expect(["opacity", "transform"]).toContain(declaration.prop),
    );
  });
  expect(keyframes).toBe(6);
  sheet.walkRules((rule) => {
    if (rule.selector.includes("img") || rule.selector.includes("picture")) {
      rule.walkDecls("transform", () => {
        throw new Error("The source photograph must stay still");
      });
    }
  });
});
