import {
  MEDIA_FRAMING_MASTER_SIZES,
  mediaFramingRequestSchema,
  mediaFramingResultSchema,
  type MediaFramingPlan,
  type MediaFramingRequest,
  type MediaFramingResult,
} from "@fan-support/contracts";

type Size = MediaFramingPlan["target"];
type Rectangle = MediaFramingPlan["sourceCrop"];

function greatestCommonDivisor(left: number, right: number): number {
  while (right !== 0) {
    const remainder = left % right;
    left = right;
    right = remainder;
  }
  return left;
}

function focalOffset(
  sourceSize: number,
  cropSize: number,
  focalPoint: number,
): number {
  return Math.max(
    0,
    Math.min(
      sourceSize - cropSize,
      Math.round(sourceSize * focalPoint - cropSize / 2),
    ),
  );
}

function coveringCrop(request: MediaFramingRequest, target: Size): Rectangle {
  const divisor = greatestCommonDivisor(target.width, target.height);
  const aspectWidth = target.width / divisor;
  const aspectHeight = target.height / divisor;
  const horizontalUnits = BigInt(request.sourceWidth) / BigInt(aspectWidth);
  const verticalUnits = BigInt(request.sourceHeight) / BigInt(aspectHeight);
  const units =
    horizontalUnits < verticalUnits ? horizontalUnits : verticalUnits;
  const width = Number(units * BigInt(aspectWidth));
  const height = Number(units * BigInt(aspectHeight));
  return {
    x: focalOffset(request.sourceWidth, width, request.focalPoint.x),
    y: focalOffset(request.sourceHeight, height, request.focalPoint.y),
    width,
    height,
  };
}

function roundedRatio(numerator: bigint, denominator: bigint): number {
  return Number((2n * numerator + denominator) / (2n * denominator));
}

function containedPlacement(
  request: MediaFramingRequest,
  target: Size,
): Rectangle {
  if (
    request.sourceWidth <= target.width &&
    request.sourceHeight <= target.height
  )
    return {
      x: Math.floor((target.width - request.sourceWidth) / 2),
      y: Math.floor((target.height - request.sourceHeight) / 2),
      width: request.sourceWidth,
      height: request.sourceHeight,
    };
  const widthLimited =
    BigInt(request.sourceWidth) * BigInt(target.height) >=
    BigInt(request.sourceHeight) * BigInt(target.width);
  const width = widthLimited
    ? target.width
    : roundedRatio(
        BigInt(request.sourceWidth) * BigInt(target.height),
        BigInt(request.sourceHeight),
      );
  const height = widthLimited
    ? roundedRatio(
        BigInt(request.sourceHeight) * BigInt(target.width),
        BigInt(request.sourceWidth),
      )
    : target.height;
  return {
    x: Math.floor((target.width - width) / 2),
    y: Math.floor((target.height - height) / 2),
    width,
    height,
  };
}

/**
 * Plans geometry only. A worker must independently decode and verify the source,
 * strip metadata, encode derivatives and record processing evidence before use.
 */
export function planMediaFraming(input: unknown): MediaFramingResult {
  const parsed = mediaFramingRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      schemaVersion: 1,
      outcome: "FAILURE",
      error: { code: "INVALID_REQUEST" },
    };
  }
  const request = parsed.data;
  const target = MEDIA_FRAMING_MASTER_SIZES[request.role];
  const covers = request.fit !== "CONTAIN";
  const sourceCrop = covers
    ? coveringCrop(request, target)
    : {
        x: 0,
        y: 0,
        width: request.sourceWidth,
        height: request.sourceHeight,
      };
  const destination = covers
    ? { x: 0, y: 0, ...target }
    : containedPlacement(request, target);
  // Only the daily fill policy may enlarge a crop that is smaller than the canvas.
  const enlargementAllowed = request.fit === "COVER_ALLOW_ENLARGE";

  if (
    (!enlargementAllowed &&
      (sourceCrop.width < destination.width ||
        sourceCrop.height < destination.height)) ||
    sourceCrop.width < 1 ||
    sourceCrop.height < 1 ||
    destination.width < 1 ||
    destination.height < 1
  ) {
    return {
      schemaVersion: 1,
      outcome: "FAILURE",
      error: {
        code: "SOURCE_TOO_SMALL",
        role: request.role,
        minimumTarget: { ...target },
      },
    };
  }
  return mediaFramingResultSchema.parse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    plan: {
      schemaVersion: 1,
      request,
      target,
      sourceCrop,
      destination,
      background: covers ? "NONE" : "NEUTRAL",
    },
  });
}
