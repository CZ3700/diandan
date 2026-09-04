import type { CSSProperties, ReactElement } from "react";

import {
  CompositeMediaFrameClient,
  ResponsiveCompositeMediaClient,
} from "./composite-media-client.js";
import type {
  CompositeMedia,
  CompositeResponsiveMedia,
} from "./composite-types.js";
import {
  mediaFocalPointPosition,
  resolveMediaAlternative,
  validateMediaDimensions,
  type MediaFit,
} from "./media-frame.js";

export function CompositeMediaFrame({
  className,
  fit = "cover",
  media,
}: Readonly<{
  className: string;
  fit?: MediaFit;
  media: CompositeMedia;
}>): ReactElement {
  validateMediaDimensions(media.width, media.height);
  if (media.src.trim().length === 0) {
    throw new TypeError("Composite media source must be non-empty.");
  }

  return (
    <CompositeMediaFrameClient
      alternative={resolveMediaAlternative({
        alt: media.alt,
        fallbackLabel: media.fallbackLabel,
      })}
      className={className}
      fit={fit}
      media={media}
    />
  );
}

type ResponsiveMediaStyle = CSSProperties &
  Readonly<{
    "--fs-hero-focal-desktop": string;
    "--fs-hero-focal-mobile": string;
  }>;

export function ResponsiveCompositeMedia({
  media,
}: Readonly<{ media: CompositeResponsiveMedia }>): ReactElement {
  validateMediaDimensions(media.desktop.width, media.desktop.height);
  validateMediaDimensions(media.mobile.width, media.mobile.height);
  if (
    media.desktop.src.trim().length === 0 ||
    media.mobile.src.trim().length === 0
  ) {
    throw new TypeError(
      "Responsive composite media sources must be non-empty.",
    );
  }

  const style: ResponsiveMediaStyle = {
    "--fs-hero-focal-desktop": mediaFocalPointPosition(
      media.desktop.focalPoint,
    ),
    "--fs-hero-focal-mobile": mediaFocalPointPosition(media.mobile.focalPoint),
  };

  return (
    <ResponsiveCompositeMediaClient
      alternative={resolveMediaAlternative({
        alt: media.alt,
        fallbackLabel: media.fallbackLabel,
      })}
      media={media}
      style={style}
    />
  );
}
