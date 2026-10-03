"use client";

import * as React from "react";

import type {
  CompositeMedia,
  CompositeResponsiveMedia,
} from "./composite-types.js";
import {
  createMediaResourceIdentity,
  MediaFallback,
  MediaFrame,
  type MediaFit,
  type ResolvedMediaAlternative,
} from "./media-frame.js";

function useRuntimeMediaFailure(resourceIdentity: string): Readonly<{
  clearFailure: () => void;
  imageRef: React.RefObject<HTMLImageElement | null>;
  runtimeFailed: boolean;
  setFailure: () => void;
}> {
  const imageRef = React.useRef<HTMLImageElement>(null);
  const [failedResourceIdentity, setFailedResourceIdentity] = React.useState<
    string | null
  >(null);

  React.useEffect(() => {
    const image = imageRef.current;
    if (image?.complete === true && image.naturalWidth === 0) {
      setFailedResourceIdentity(resourceIdentity);
    }
  }, [resourceIdentity]);

  return {
    clearFailure: () => setFailedResourceIdentity(null),
    imageRef,
    runtimeFailed: failedResourceIdentity === resourceIdentity,
    setFailure: () => setFailedResourceIdentity(resourceIdentity),
  };
}

function resolveMediaFailure(
  state: "error" | "ready",
  runtimeFailed: boolean,
): Readonly<{
  failed: boolean;
  failureOrigin: "declared" | "runtime";
}> {
  return {
    failed: state === "error" || runtimeFailed,
    failureOrigin: state === "error" ? "declared" : "runtime",
  };
}

export function CompositeMediaFrameClient({
  alternative,
  className,
  fit,
  media,
}: Readonly<{
  alternative: ResolvedMediaAlternative;
  className: string;
  fit: MediaFit;
  media: CompositeMedia;
}>): React.ReactElement {
  const failure = useRuntimeMediaFailure(createMediaResourceIdentity(media));
  const { failed, failureOrigin } = resolveMediaFailure(
    media.state,
    failure.runtimeFailed,
  );

  return (
    <MediaFrame
      alternative={alternative}
      className={className}
      failed={failed}
      failureOrigin={failureOrigin}
      fit={fit}
      focalPoint={media.focalPoint}
      height={media.height}
      imageRef={failure.imageRef}
      onError={failure.setFailure}
      onLoad={failure.clearFailure}
      src={media.src}
      width={media.width}
      {...(media.sizes === undefined ? {} : { sizes: media.sizes })}
      {...(media.srcSet === undefined ? {} : { srcSet: media.srcSet })}
    />
  );
}

type ResponsiveMediaStyle = React.CSSProperties &
  Readonly<{
    "--fs-hero-focal-desktop": string;
    "--fs-hero-focal-mobile": string;
  }>;

export function ResponsiveCompositeMediaClient({
  alternative,
  media,
  style,
}: Readonly<{
  alternative: ResolvedMediaAlternative;
  media: CompositeResponsiveMedia;
  style: ResponsiveMediaStyle;
}>): React.ReactElement {
  const resourceIdentity = JSON.stringify([
    createMediaResourceIdentity(media.desktop),
    createMediaResourceIdentity(media.mobile),
  ]);
  const failure = useRuntimeMediaFailure(resourceIdentity);
  const { failed, failureOrigin } = resolveMediaFailure(
    media.state,
    failure.runtimeFailed,
  );

  return (
    <div
      className="fs-media fs-media--cover fs-hero__media"
      data-media-error-source={failed ? failureOrigin : undefined}
      data-media-state={failed ? "error" : "ready"}
      style={style}
    >
      {failed ? (
        <MediaFallback alternative={alternative} />
      ) : (
        <picture>
          <source
            height={media.mobile.height}
            media="(max-width: 47.999rem)"
            sizes={media.mobile.sizes}
            srcSet={media.mobile.srcSet ?? media.mobile.src}
            width={media.mobile.width}
          />
          <img
            alt={alternative.imageAlt}
            className="fs-media__image fs-hero__image"
            decoding="async"
            fetchPriority="high"
            height={media.desktop.height}
            loading="eager"
            onError={failure.setFailure}
            onLoad={failure.clearFailure}
            ref={failure.imageRef}
            sizes={media.desktop.sizes}
            src={media.desktop.src}
            srcSet={media.desktop.srcSet}
            // WeChat injects an inline style on <img> before hydration; focus is on the frame.
            suppressHydrationWarning
            width={media.desktop.width}
          />
        </picture>
      )}
    </div>
  );
}
