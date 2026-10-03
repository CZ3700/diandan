import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import type { PublishedMediaView } from "@fan-support/contracts";

import { PublishedHeroImage, PublishedImage } from "./published-image.js";

const media = {
  schemaVersion: 1,
  kind: "INFORMATIVE",
  url: "https://media.example.invalid/processed/v1/master/portrait.webp",
  alt: "Artist portrait",
  width: 1600,
  height: 2000,
  focalPoint: { x: 0.4, y: 0.3 },
} as PublishedMediaView;

test("original image alt retains its actual language in card and hero", () => {
  const original = {
    ...media,
    schemaVersion: 2,
    localeContext: {
      schemaVersion: 2,
      publicationMode: "DIRECT_OPERATOR_V1",
      sourceLocale: "zh-CN",
      requestedLocale: "en",
      resolvedLocale: "zh-CN",
      fallbackUsed: true,
      translationRevision: "cc000000-0000-4000-8000-000000000001",
    },
  } as PublishedMediaView;
  expect(
    attributes(
      renderToStaticMarkup(
        <PublishedImage media={original} fallbackLabel="Unavailable" />,
      ),
      "img",
    ).lang,
  ).toBe("zh-CN");
  expect(
    attributes(
      renderToStaticMarkup(
        <PublishedHeroImage
          desktop={original}
          mobile={original}
          fallbackLabel="Unavailable"
        />,
      ),
      "img",
    ).lang,
  ).toBe("zh-CN");
});

function attributes(html: string, tag: string) {
  const element = html.match(new RegExp(`<${tag}\\s[^>]*>`));
  expect(element, `${tag} exists`).not.toBeNull();
  return Object.fromEntries(
    [...(element?.[0] ?? "").matchAll(/([\w-]+)="([^"]*)"/gu)].map(
      ([, name, value]) => [
        name,
        value?.replaceAll("&amp;", "&").replaceAll("&lt;", "<"),
      ],
    ),
  );
}

function candidates(srcSet: string | undefined) {
  expect(srcSet, "responsive candidates exist").toBeTypeOf("string");
  return (srcSet ?? "").split(", ").map((candidate) => {
    const [url, descriptor] = candidate.split(" ");
    expect(descriptor).toMatch(/^\d+w$/u);
    return {
      url: new URL(url ?? "", "https://storefront.example.invalid"),
      width: Number(descriptor?.slice(0, -1)),
    };
  });
}

test("responsive candidates optimize only the published source and never advertise enlarged widths", () => {
  const html = renderToStaticMarkup(
    <PublishedImage media={media} fallbackLabel="Image unavailable" />,
  );
  const img = attributes(html, "img");
  const variants = candidates(img.srcSet);
  expect(variants.length).toBeGreaterThan(1);
  for (const variant of variants) {
    expect(variant.url.pathname).toBe("/_next/image");
    expect(variant.url.searchParams.get("url")).toBe(media.url);
    expect(variant.url.searchParams.get("q")).toBe("75");
    expect(Number(variant.url.searchParams.get("w"))).toBe(variant.width);
    expect(variant.width).toBeLessThanOrEqual(media.width);
  }
  const largest = variants.at(-1)?.url;
  expect(img.src).toBe(`${largest?.pathname}${largest?.search}`);
  expect(img.alt).toBe(media.alt);
  expect(img.loading).toBe("lazy");
  expect(img.fetchPriority).toBe("auto");
  expect(img.width).toBe("1600");
  expect(img.height).toBe("2000");
  expect(img.sizes).toContain("78vw");
  // The focus rides on the frame; WeChat may overwrite <img style> before hydration.
  expect(html).toContain("--fs-media-focus:40% 30%");
});

test("each hero composition has its own bounded candidates and mobile fallback uses eager priority", () => {
  const desktop = { ...media, width: 2400, height: 1350 };
  const mobile = {
    ...media,
    url: media.url.replace("portrait", "mobile") as PublishedMediaView["url"],
    width: 1080,
    height: 1350,
  };
  const html = renderToStaticMarkup(
    <PublishedHeroImage
      desktop={desktop}
      mobile={mobile}
      fallbackLabel="Unavailable"
    />,
  );
  const source = attributes(html, "source");
  const img = attributes(html, "img");
  expect(source.media).toBe("(min-width: 48rem)");
  expect(source.sizes).toBe("100vw");
  for (const [values, original] of [
    [source, desktop],
    [img, mobile],
  ] as const) {
    expect(candidates(values.srcSet).length).toBeGreaterThan(1);
    for (const variant of candidates(values.srcSet)) {
      expect(variant.url.searchParams.get("url")).toBe(original.url);
      expect(variant.width).toBeLessThanOrEqual(original.width);
    }
  }
  expect(img.loading).toBe("eager");
  expect(img.fetchPriority).toBe("high");
  expect(img.sizes).toBe("100vw");
  expect(img.alt).toBe(mobile.alt);
  expect(img.width).toBe("1080");
  expect(img.height).toBe("1350");
  expect(html).toContain("--hero-mobile-aspect:1080/1350");
  const preloads = [...html.matchAll(/<link\s[^>]*>/gu)].map(([link]) =>
    attributes(link, "link"),
  );
  expect(preloads).toHaveLength(2);
  expect(preloads.map((link) => link.media)).toEqual([
    "(min-width: 48rem)",
    "(width < 48rem)",
  ]);
  for (const link of preloads) {
    expect(link.rel).toBe("preload");
    expect(link.as).toBe("image");
    expect(link.imageSizes).toBe("100vw");
    expect(link.imageSrcSet).toBe(
      link.media === source.media ? source.srcSet : img.srcSet,
    );
  }
});

test("decorative media remains silent and an explicit display size is preserved", () => {
  const decorative = {
    ...media,
    kind: "DECORATIVE",
    alt: "",
  } as PublishedMediaView;
  const html = renderToStaticMarkup(
    <PublishedImage
      media={decorative}
      fallbackLabel="Unavailable"
      priority
      sizes="50vw"
    />,
  );
  const img = attributes(html, "img");
  expect(img.alt).toBe("");
  expect(img.sizes).toBe("50vw");
  expect(img.loading).toBe("eager");
  expect(html).not.toContain("Unavailable");
});

test("a source smaller than the smallest optimizer width keeps its real intrinsic width", () => {
  const tiny = { ...media, width: 16, height: 20 };
  const img = attributes(
    renderToStaticMarkup(
      <PublishedImage media={tiny} fallbackLabel="Unavailable" />,
    ),
    "img",
  );
  expect(img.src).toBe(tiny.url);
  expect(img.srcSet).toBe(`${tiny.url} 16w`);
});

test("hero decorations belong to its image frame without changing the published photograph", () => {
  const html = renderToStaticMarkup(
    <PublishedHeroImage
      desktop={media}
      mobile={media}
      fallbackLabel="Unavailable"
    >
      <button type="button">Pause motion</button>
    </PublishedHeroImage>,
  );
  expect(html).toContain(
    '</picture><button type="button">Pause motion</button>',
  );
  expect(attributes(html, "img").alt).toBe(media.alt);
  expect(html).toContain("--hero-desktop-focus:40% 30%");
});
