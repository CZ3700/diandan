import { readFile } from "node:fs/promises";
import postcss from "postcss";
import { expect, test } from "vitest";

/** Bounded specificity check for the hero's simple selectors. Unsupported syntax
 * fails explicitly rather than pretending to be a general browser CSS engine. */
function specificity(selector: string): number[] {
  let source = selector;
  for (
    let start = source.indexOf(":where(");
    start !== -1;
    start = source.indexOf(":where(")
  ) {
    let depth = 1;
    let end = start + 7;
    while (depth > 0 && end < source.length) {
      if (source[end] === "(") depth++;
      if (source[end] === ")") depth--;
      end++;
    }
    expect(depth).toBe(0);
    source = source.slice(0, start) + source.slice(end);
  }
  // :not takes its argument's specificity, without adding a pseudo-class.
  source = source.replaceAll(":not(", "(");
  let classes = 0;
  let elements = 0;
  source = source.replace(/\[[^\]]+\]|\.[\w-]+/gu, () => {
    classes++;
    return "";
  });
  source = source.replace(/\b(?:html|span)\b/gu, () => {
    elements++;
    return "";
  });
  expect(
    source.replace(/[\s>()]/gu, ""),
    "unsupported hero selector syntax",
  ).toBe("");
  return [0, classes, elements];
}

test("the paused declaration wins the real hero cascade over the animation shorthand reset", async () => {
  const sheet = postcss.parse(
    await readFile(new URL("./hero-motion.css", import.meta.url), "utf8"),
  );
  const declarations: Array<{
    specificity: number[];
    order: number;
    value: string;
  }> = [];
  sheet.walkRules((rule) => {
    if (!rule.selector.includes(".storefront-hero-sparkles")) return;
    rule.walkDecls((declaration) => {
      if (
        declaration.prop !== "animation" &&
        declaration.prop !== "animation-play-state"
      )
        return;
      expect(rule.selector).toContain('[data-storefront-motion="STANDARD"]');
      declarations.push({
        specificity: specificity(rule.selector),
        order: declarations.length,
        // The animation shorthand resets omitted play-state to its initial running value.
        value: declaration.prop === "animation" ? "running" : declaration.value,
      });
    });
  });
  expect(declarations.map((item) => item.value).sort()).toEqual([
    "paused",
    "running",
  ]);
  declarations.sort((a, b) => {
    for (let index = 0; index < 3; index++) {
      const difference = a.specificity[index]! - b.specificity[index]!;
      if (difference !== 0) return difference;
    }
    return a.order - b.order;
  });
  expect(declarations.at(-1)?.value).toBe("paused");
});
