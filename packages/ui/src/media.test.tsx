import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import {
  createMediaResourceIdentity,
  Media,
  MediaFallback,
  MediaFrame,
  resolveMediaAlternative,
  type MediaProps,
} from "./media.js";

describe("Media", () => {
  test("treats srcSet and sizes changes as a new retryable resource", () => {
    const failed = createMediaResourceIdentity({
      sizes: "100vw",
      src: "/portrait.avif",
      srcSet: "/broken-portrait.avif 800w",
    });

    expect(
      createMediaResourceIdentity({
        sizes: "100vw",
        src: "/portrait.avif",
        srcSet: "/repaired-portrait.avif 800w",
      }),
    ).not.toBe(failed);
    expect(
      createMediaResourceIdentity({
        sizes: "50vw",
        src: "/portrait.avif",
        srcSet: "/broken-portrait.avif 800w",
      }),
    ).not.toBe(failed);
  });

  test("renders an informative native image with intrinsic dimensions", () => {
    const markup = renderToStaticMarkup(
      <Media
        alt="A fictional idol holding a bouquet"
        className="portrait"
        fallbackLabel="Portrait unavailable"
        fit="cover"
        height={1_000}
        sizes="(min-width: 64rem) 40vw, 100vw"
        src="https://media.example.test/portrait.avif"
        srcSet="https://media.example.test/portrait-400.avif 400w, https://media.example.test/portrait.avif 800w"
        width={800}
      />,
    );

    expect(markup).toContain("fs-media--cover");
    expect(markup).toContain("portrait");
    expect(markup).toContain('data-media-state="ready"');
    expect(markup).toContain('style="aspect-ratio:800 / 1000"');
    expect(markup).toMatch(
      /<img[^>]+alt="A fictional idol holding a bouquet"/u,
    );
    expect(markup).toContain('width="800"');
    expect(markup).toContain('height="1000"');
    expect(markup).toContain('loading="lazy"');
    expect(markup).toContain('decoding="async"');
    expect(markup).toContain('sizes="(min-width: 64rem) 40vw, 100vw"');
    expect(markup).toContain("portrait-400.avif 400w");
  });

  test("uses an explicit empty alternative for decorative media", () => {
    const markup = renderToStaticMarkup(
      <Media
        decorative
        fit="contain"
        height={9}
        src="https://media.example.test/texture.webp"
        width={16}
      />,
    );

    expect(markup).toContain("fs-media--contain");
    expect(markup).toMatch(/<img[^>]+alt=""/u);
  });

  test("renders a localized informative fallback without collapsing its ratio", () => {
    const alternative = resolveMediaAlternative({
      alt: "偶像肖像",
      fallbackLabel: "暂时无法加载肖像",
    });
    const markup = renderToStaticMarkup(
      <MediaFrame
        alternative={alternative}
        failed
        height={5}
        onError={() => undefined}
        onLoad={() => undefined}
        src="https://media.example.test/missing.avif"
        width={4}
      />,
    );

    expect(markup).toContain('style="aspect-ratio:4 / 5"');
    expect(markup).toContain('data-media-state="error"');
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="暂时无法加载肖像"');
    expect(markup).toContain("暂时无法加载肖像");
    expect(markup).not.toContain("<img");
  });

  test("keeps decorative fallbacks silent", () => {
    const alternative = resolveMediaAlternative({ decorative: true });
    const markup = renderToStaticMarkup(
      <MediaFallback alternative={alternative} />,
    );

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain('role="img"');
  });

  test("rejects ambiguous alternatives and invalid dimensions", () => {
    expect(() => resolveMediaAlternative({ alt: "   " })).toThrow(
      /non-empty alt/u,
    );
    expect(() =>
      resolveMediaAlternative({ alt: "Portrait", fallbackLabel: "  " }),
    ).toThrow(/fallbackLabel.*non-empty/u);
    expect(() =>
      renderToStaticMarkup(
        <Media
          alt="Portrait"
          height={1_000}
          src="https://media.example.test/portrait.avif"
          width={0}
        />,
      ),
    ).toThrow(/positive safe integers/u);
  });
});

const decorativeMedia = {
  decorative: true,
  height: 9,
  src: "https://media.example.test/texture.webp",
  width: 16,
} satisfies MediaProps;
void decorativeMedia;

// @ts-expect-error Decorative media cannot expose a spoken alternative.
const ambiguousMedia: MediaProps = {
  alt: "This must not be announced",
  decorative: true,
  height: 9,
  src: "https://media.example.test/texture.webp",
  width: 16,
};
void ambiguousMedia;
