import { readFile } from "node:fs/promises";
import postcss from "postcss";
import { expect, test } from "vitest";

test("the homepage immersive scrim is localized instead of washing the full image edge", async () => {
  const sheet = postcss.parse(
    await readFile(new URL("./storefront.css", import.meta.url), "utf8"),
  );
  const backgrounds: string[] = [];
  sheet.walkRules((rule) => {
    if (
      !rule.selector.includes('[data-storefront-hero-layout="IMMERSIVE"]') ||
      !rule.selector.includes("[data-home-hero]::after") ||
      rule.parent?.type !== "root"
    )
      return;
    rule.walkDecls("background", (declaration) => {
      backgrounds.push(declaration.value);
    });
  });
  expect(backgrounds.length).toBeGreaterThan(0);
  for (const value of backgrounds) {
    expect(value).toContain("radial-gradient");
    expect(value).toContain("at left bottom");
    expect(value).not.toContain("linear-gradient");
  }
});

test("the light mobile homepage protects all subtitle lines only at the foot of the image", async () => {
  const sheet = postcss.parse(
    await readFile(new URL("./storefront.css", import.meta.url), "utf8"),
  );
  const backgrounds: string[] = [];
  sheet.walkAtRules("media", (media) => {
    if (media.params !== "(width < 48rem)") return;
    media.walkRules((rule) => {
      if (
        !rule.selector.includes('[data-storefront-scheme="LIGHT"]') ||
        !rule.selector.includes('[data-storefront-hero-layout="IMMERSIVE"]') ||
        !rule.selector.includes("[data-home-hero]::after")
      )
        return;
      rule.walkDecls("background", (declaration) => {
        backgrounds.push(declaration.value);
      });
    });
  });
  expect(backgrounds).toHaveLength(1);
  const background = backgrounds[0]!;
  expect(background).toContain("linear-gradient");
  expect(background).toContain("to top");
  expect(background).toContain("95%, transparent) 0%");
  expect(background).toContain("85%, transparent) 10%");
  expect(background).toContain("transparent 24%");
});
