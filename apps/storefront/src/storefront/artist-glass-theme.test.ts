import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

const css = () =>
  readFile(new URL("./artist-directory.module.css", import.meta.url), "utf8");

test("the glass mount retunes for light palettes: white highlight, ink-tinted edge and shadow (L2-16)", async () => {
  const source = await css();
  const light = [
    ...source.matchAll(
      /:global\(html\[data-storefront-scheme="LIGHT"\]\) \.card(?<rest>[^{]*)\{(?<body>[^}]+)\}/gu,
    ),
  ];
  const card = light.find((match) => match.groups?.["rest"]?.trim() === "");
  expect(card?.groups?.["body"]).toMatch(
    /--artist-glass-light: var\(--color-surface-raised\);/u,
  );
  expect(card?.groups?.["body"]).toMatch(
    /--artist-glass-shade: color-mix\(in srgb, var\(--color-text\) \d+%, transparent\);/u,
  );
  const edge = light.find(
    (match) => match.groups?.["rest"]?.trim() === "a::before",
  );
  expect(edge?.groups?.["body"]).toMatch(
    /border-color: color-mix\(in srgb, var\(--color-text\) \d+%, transparent\);/u,
  );
});

test("glass colours only come from theme tokens", async () => {
  const source = (await css()).replace(/\/\*[\s\S]*?\*\//gu, "");
  expect(source).not.toMatch(
    /#[\da-f]{3,8}\b|rgb\(|hsl\(|\b(?:white|black)\b(?!-)/iu,
  );
});
