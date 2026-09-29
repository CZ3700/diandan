"use client";

import { getImageProps } from "next/image";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import type { PublishedMediaView } from "@fan-support/contracts";
import { Media } from "@fan-support/ui/client";

const cardSizes = "(max-width: 27rem) 78vw, 21rem";

function responsiveSource(media: PublishedMediaView, sizes: string) {
  const { props } = getImageProps({
    src: media.url,
    alt: media.alt,
    width: media.width,
    height: media.height,
    quality: 75,
    // Ask the public API for its full configured width set, then apply the
    // actual layout sizes below. A vw hint here would discard useful small
    // candidates before we can cap them at the verified source dimensions.
    sizes: "1px",
  });
  const candidates = (props.srcSet ?? "").split(", ").filter((candidate) => {
    const width = candidate.match(/ (\d+)w$/u)?.[1];
    return width !== undefined && Number(width) <= media.width;
  });
  const largest = candidates.at(-1);
  return {
    src: largest?.replace(/ \d+w$/u, "") ?? media.url,
    srcSet:
      candidates.length > 0
        ? candidates.join(", ")
        : `${media.url} ${media.width}w`,
    sizes,
  };
}

export function PublishedImage({
  media,
  fallbackLabel,
  priority = false,
  className,
  sizes = cardSizes,
}: Readonly<{
  media: PublishedMediaView;
  fallbackLabel: string;
  priority?: boolean;
  className?: string;
  sizes?: string;
}>) {
  const common = {
    ...(media.schemaVersion === 2
      ? { lang: media.localeContext.resolvedLocale }
      : {}),
    ...responsiveSource(media, sizes),
    width: media.width,
    height: media.height,
    focalPoint: media.focalPoint,
    loading: priority ? ("eager" as const) : ("lazy" as const),
    fetchPriority: priority ? ("high" as const) : ("auto" as const),
    ...(className ? { className } : {}),
  };
  return media.kind === "DECORATIVE" ? (
    <Media {...common} decorative />
  ) : (
    <Media {...common} alt={media.alt} fallbackLabel={fallbackLabel} />
  );
}

/** Separate published compositions provide art direction, never inferred URLs. */
export function PublishedHeroImage({
  desktop,
  mobile,
  fallbackLabel,
}: Readonly<{
  desktop: PublishedMediaView;
  mobile: PublishedMediaView;
  fallbackLabel: string;
}>) {
  const image = useRef<HTMLImageElement>(null);
  const desktopSource = responsiveSource(desktop, "100vw");
  const mobileSource = responsiveSource(mobile, "100vw");
  const identity = JSON.stringify([desktopSource.srcSet, mobileSource.srcSet]);
  const [failedIdentity, setFailedIdentity] = useState<string | null>(null);
  useEffect(() => {
    const current = image.current;
    if (current?.complete === true && current.naturalWidth === 0)
      setFailedIdentity(identity);
  }, [identity]);
  const style = {
    "--hero-mobile-aspect": `${mobile.width}/${mobile.height}`,
    "--hero-desktop-focus": `${desktop.focalPoint.x * 100}% ${desktop.focalPoint.y * 100}%`,
    "--hero-mobile-focus": `${mobile.focalPoint.x * 100}% ${mobile.focalPoint.y * 100}%`,
  } as CSSProperties;
  return (
    <div className="storefront-hero-image" style={style}>
      <link
        rel="preload"
        as="image"
        href={desktopSource.src}
        imageSrcSet={desktopSource.srcSet}
        imageSizes={desktopSource.sizes}
        media="(min-width: 48rem)"
        fetchPriority="high"
      />
      <link
        rel="preload"
        as="image"
        href={mobileSource.src}
        imageSrcSet={mobileSource.srcSet}
        imageSizes={mobileSource.sizes}
        media="(width < 48rem)"
        fetchPriority="high"
      />
      {failedIdentity === identity ? (
        mobile.kind === "DECORATIVE" ? (
          <div className="storefront-image-fallback" aria-hidden="true" />
        ) : (
          <div
            className="storefront-image-fallback"
            role="img"
            aria-label={fallbackLabel}
          >
            {fallbackLabel}
          </div>
        )
      ) : (
        <picture>
          <source
            media="(min-width: 48rem)"
            srcSet={desktopSource.srcSet}
            sizes={desktopSource.sizes}
            width={desktop.width}
            height={desktop.height}
          />
          <img
            lang={
              mobile.schemaVersion === 2
                ? mobile.localeContext.resolvedLocale
                : undefined
            }
            ref={image}
            {...mobileSource}
            width={mobile.width}
            height={mobile.height}
            alt={mobile.alt}
            decoding="async"
            fetchPriority="high"
            loading="eager"
            // WeChat injects an inline style on <img> before hydration; focus is on the wrapper.
            suppressHydrationWarning
            onError={() => setFailedIdentity(identity)}
            onLoad={() => setFailedIdentity(null)}
          />
        </picture>
      )}
    </div>
  );
}
