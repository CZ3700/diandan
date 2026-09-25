import { readFile } from "node:fs/promises";

import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

type SpecimenModule = Readonly<{
  DesignFoundationSpecimen: (props: {
    accent?: unknown;
    locale: "en" | "en-XA" | "es" | "ja" | "pt" | "th" | "vi" | "zh-CN";
  }) => ReactElement;
}>;

async function loadSpecimen(): Promise<SpecimenModule> {
  return import("./design-foundation-specimen.js");
}

test("renders the requested script profile and full stress copy", async () => {
  const { DesignFoundationSpecimen } = await loadSpecimen();
  const markup = renderToStaticMarkup(
    DesignFoundationSpecimen({ locale: "vi" }),
  );

  const mainTag = markup.match(/^<main[^>]*>/u)?.[0];
  expect(mainTag).not.toContain("lang=");
  expect(markup).toMatch(
    /<section[^>]*lang="vi"[^>]*aria-labelledby="foundation-heading"/u,
  );
  expect(markup.match(/lang="vi"/gu)).toHaveLength(1);
  expect(markup).toContain('data-font-profile="vietnamese"');
  expect(markup).toContain("Món quà chân thành");
  expect(markup).toContain("Nguyễn, Trường và ươm mầm");
  expect(markup).toContain('href="/healthz"');
});

test("applies only a contrast-safe scoped accent to the preview", async () => {
  const { DesignFoundationSpecimen } = await loadSpecimen();
  const markup = renderToStaticMarkup(
    DesignFoundationSpecimen({ accent: "#101014", locale: "en" }),
  );

  expect(markup).toContain("--idol-accent:#d8b26e");
  expect(markup).toContain('data-accent-fallback="true"');
  const scopedStyle = markup.match(/<main[^>]+style="([^"]+)"/u)?.[1];
  expect(scopedStyle).toBe("--idol-accent:#d8b26e");
});

test("keeps the pseudo locale visibly isolated as an internal fixture", async () => {
  const { DesignFoundationSpecimen } = await loadSpecimen();
  const markup = renderToStaticMarkup(
    DesignFoundationSpecimen({ locale: "en-XA" }),
  );

  expect(markup).toMatch(
    /<section[^>]*lang="en-XA"[^>]*aria-labelledby="foundation-heading"/u,
  );
  expect(markup.match(/lang="en-XA"/gu)).toHaveLength(1);
  expect(markup).toContain("Pseudo · expansion fixture");
  expect(markup).toContain("Internal specimen — not customer content");
});

test("uses relaxed tokenized leading for every non-Latin font profile", async () => {
  const css = await readFile(
    new URL("./design-foundation-specimen.module.css", import.meta.url),
    "utf8",
  );
  const relaxedLeadingBlock = css.match(
    /\[data-font-profile="simplified-chinese"\]\.specimen,[\s\S]*?\{[\s\S]*?--type-display-leading: var\(--type-display-script-leading\);[\s\S]*?--type-heading-leading: var\(--type-heading-script-leading\);[\s\S]*?\}/u,
  )?.[0];

  for (const profile of [
    "japanese",
    "simplified-chinese",
    "thai",
    "vietnamese",
  ]) {
    expect(relaxedLeadingBlock).toContain(
      `[data-font-profile="${profile}"].specimen`,
    );
  }
  expect(relaxedLeadingBlock).toBeDefined();
});
