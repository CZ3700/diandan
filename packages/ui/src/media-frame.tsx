import type { CSSProperties, ReactElement, Ref } from "react";

export type MediaFit = "contain" | "cover";

export type MediaFocalPoint = Readonly<{ x: number; y: number }>;

export type CommonMediaProps = Readonly<{
  className?: string;
  decoding?: "async" | "auto" | "sync";
  fetchPriority?: "auto" | "high" | "low";
  fit?: MediaFit;
  focalPoint?: MediaFocalPoint;
  height: number;
  imageClassName?: string;
  lang?: string;
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

export type MediaFrameProps = CommonMediaProps &
  Readonly<{
    alternative: ResolvedMediaAlternative;
    failed: boolean;
    failureOrigin?: "declared" | "runtime";
    imageRef?: Ref<HTMLImageElement>;
    onError?: () => void;
    onLoad?: () => void;
  }>;

function hasText(value: string): boolean {
  return value.trim().length > 0;
}

function classNames(...values: ReadonlyArray<string | undefined>): string {
  return values
    .filter((value): value is string => value !== undefined)
    .join(" ");
}

export function validateMediaDimensions(width: number, height: number): void {
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

export function mediaFocalPointPosition(focalPoint: MediaFocalPoint): string {
  if (
    !Number.isFinite(focalPoint.x) ||
    focalPoint.x < 0 ||
    focalPoint.x > 1 ||
    !Number.isFinite(focalPoint.y) ||
    focalPoint.y < 0 ||
    focalPoint.y > 1
  ) {
    throw new RangeError(
      "Media focal point coordinates must be between 0 and 1.",
    );
  }
  return `${focalPoint.x * 100}% ${focalPoint.y * 100}%`;
}

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
  failureOrigin,
  fetchPriority,
  fit = "cover",
  focalPoint,
  height,
  imageClassName,
  imageRef,
  lang,
  loading = "lazy",
  onError,
  onLoad,
  sizes,
  src,
  srcSet,
  width,
}: MediaFrameProps): ReactElement {
  validateMediaDimensions(width, height);
  if (!hasText(src)) {
    throw new TypeError("Media src must be non-empty.");
  }

  return (
    // The focus sits on the frame, not <img style>: in-app browsers (WeChat) overwrite the
    // image's inline style before hydration, which would drop the focus.
    <div
      className={classNames("fs-media", `fs-media--${fit}`, className)}
      data-media-error-source={failed ? failureOrigin : undefined}
      data-media-focus={focalPoint === undefined ? undefined : "true"}
      data-media-state={failed ? "error" : "ready"}
      style={
        {
          aspectRatio: `${width} / ${height}`,
          ...(focalPoint === undefined
            ? {}
            : { "--fs-media-focus": mediaFocalPointPosition(focalPoint) }),
        } as CSSProperties
      }
    >
      {failed ? (
        <MediaFallback alternative={alternative} />
      ) : (
        <img
          lang={lang}
          alt={alternative.imageAlt}
          className={classNames("fs-media__image", imageClassName)}
          decoding={decoding}
          fetchPriority={fetchPriority}
          height={height}
          loading={loading}
          onError={onError}
          onLoad={onLoad}
          ref={imageRef}
          sizes={sizes}
          src={src}
          srcSet={srcSet}
          // Foreign attributes injected on <img> (WeChat's style) are ignored, only here.
          suppressHydrationWarning
          width={width}
        />
      )}
    </div>
  );
}
