"use client";

import { useState, type ReactElement } from "react";

export type MediaFit = "contain" | "cover";

type CommonMediaProps = Readonly<{
  className?: string;
  decoding?: "async" | "auto" | "sync";
  fetchPriority?: "auto" | "high" | "low";
  fit?: MediaFit;
  height: number;
  imageClassName?: string;
  loading?: "eager" | "lazy";
  sizes?: string;
  src: string;
  srcSet?: string;
  width: number;
}>;

export type MediaAlternativeInput =
  | Readonly<{
      alt: string;
      decorative?: false;
      fallbackLabel?: string;
    }>
  | Readonly<{
      alt?: never;
      decorative: true;
      fallbackLabel?: never;
    }>;

export type MediaProps = CommonMediaProps & MediaAlternativeInput;

export type ResolvedMediaAlternative =
  | Readonly<{
      decorative: false;
      fallbackLabel: string;
      imageAlt: string;
    }>
  | Readonly<{
      decorative: true;
      fallbackLabel: null;
      imageAlt: "";
    }>;

export function createMediaResourceIdentity({
  sizes,
  src,
  srcSet,
}: Readonly<{
  sizes?: string;
  src: string;
  srcSet?: string;
}>): string {
  return JSON.stringify([src, srcSet ?? null, sizes ?? null]);
}

export type MediaFrameProps = CommonMediaProps &
  Readonly<{
    alternative: ResolvedMediaAlternative;
    failed: boolean;
    onError: () => void;
    onLoad: () => void;
  }>;

function hasText(value: string): boolean {
  return value.trim().length > 0;
}

function classNames(...values: ReadonlyArray<string | undefined>): string {
  return values
    .filter((value): value is string => value !== undefined)
    .join(" ");
}

function validateDimensions(width: number, height: number): void {
  if (
    !Number.isSafeInteger(width) ||
    width <= 0 ||
    !Number.isSafeInteger(height) ||
    height <= 0
  ) {
    throw new RangeError(
      "Media width and height must be positive safe integers.",
    );
  }
}

export function resolveMediaAlternative(
  input: MediaAlternativeInput,
): ResolvedMediaAlternative {
  if (input.decorative === true) {
    return {
      decorative: true,
      fallbackLabel: null,
      imageAlt: "",
    };
  }

  if (!hasText(input.alt)) {
    throw new TypeError(
      "Informative media requires a non-empty alt; use decorative for silent media.",
    );
  }
  if (input.fallbackLabel !== undefined && !hasText(input.fallbackLabel)) {
    throw new TypeError(
      "Informative media fallbackLabel must be non-empty when provided.",
    );
  }

  return {
    decorative: false,
    fallbackLabel: input.fallbackLabel ?? input.alt,
    imageAlt: input.alt,
  };
}

export function MediaFallback({
  alternative,
}: Readonly<{ alternative: ResolvedMediaAlternative }>): ReactElement {
  if (alternative.decorative) {
    return (
      <span
        aria-hidden="true"
        className="fs-media__fallback"
        data-media-fallback="decorative"
      />
    );
  }

  return (
    <span
      aria-label={alternative.fallbackLabel}
      className="fs-media__fallback"
      data-media-fallback="informative"
      role="img"
    >
      {alternative.fallbackLabel}
    </span>
  );
}

export function MediaFrame({
  alternative,
  className,
  decoding = "async",
  failed,
  fetchPriority,
  fit = "cover",
  height,
  imageClassName,
  loading = "lazy",
  onError,
  onLoad,
  sizes,
  src,
  srcSet,
  width,
}: MediaFrameProps): ReactElement {
  validateDimensions(width, height);
  if (!hasText(src)) {
    throw new TypeError("Media src must be non-empty.");
  }

  return (
    <div
      className={classNames("fs-media", `fs-media--${fit}`, className)}
      data-media-state={failed ? "error" : "ready"}
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      {failed ? (
        <MediaFallback alternative={alternative} />
      ) : (
        <img
          alt={alternative.imageAlt}
          className={classNames("fs-media__image", imageClassName)}
          decoding={decoding}
          fetchPriority={fetchPriority}
          height={height}
          loading={loading}
          onError={onError}
          onLoad={onLoad}
          sizes={sizes}
          src={src}
          srcSet={srcSet}
          width={width}
        />
      )}
    </div>
  );
}

export function Media(props: MediaProps): ReactElement {
  const [failedResourceIdentity, setFailedResourceIdentity] = useState<
    string | null
  >(null);
  const alternative = resolveMediaAlternative(props);
  const resourceIdentity = createMediaResourceIdentity(props);

  return (
    <MediaFrame
      {...props}
      alternative={alternative}
      failed={failedResourceIdentity === resourceIdentity}
      onError={() => setFailedResourceIdentity(resourceIdentity)}
      onLoad={() => setFailedResourceIdentity(null)}
    />
  );
}
