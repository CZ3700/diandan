import { z } from "zod";

import { sourceHashSchema } from "./content-lifecycle.js";
import {
  mediaAssetIdSchema,
  mediaMetadataRevisionIdSchema,
} from "./identifiers.js";
import { mediaFocalPointSchema } from "./media-content.js";
import { schemaVersionSchema } from "./versioning.js";

const roleSchema = z.enum([
  "PORTRAIT",
  "HERO_DESKTOP",
  "HERO_MOBILE",
  "GIFT_PRIMARY",
]);

/** Qualified master sizes; smaller responsive derivatives are a later step. */
export const MEDIA_FRAMING_MASTER_SIZES = Object.freeze({
  PORTRAIT: Object.freeze({ width: 1_600, height: 2_000 }),
  HERO_DESKTOP: Object.freeze({ width: 2_400, height: 1_350 }),
  HERO_MOBILE: Object.freeze({ width: 1_080, height: 1_350 }),
  GIFT_PRIMARY: Object.freeze({ width: 1_200, height: 1_200 }),
});

const dimensionSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const coordinateSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const sizeSchema = z.strictObject({
  width: dimensionSchema,
  height: dimensionSchema,
});
const rectangleSchema = z.strictObject({
  x: coordinateSchema,
  y: coordinateSchema,
  ...sizeSchema.shape,
});

export const mediaFramingRequestSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  assetId: mediaAssetIdSchema,
  metadataRevisionId: mediaMetadataRevisionIdSchema,
  sourceChecksum: sourceHashSchema,
  // Dimensions describe decoded pixels after EXIF orientation correction.
  sourceWidth: dimensionSchema,
  sourceHeight: dimensionSchema,
  role: roleSchema,
  // COVER and CONTAIN never enlarge (strict qualification). COVER_ALLOW_ENLARGE is the daily
  // management policy (user decision 2026-09-27): fill the role's ratio, enlarging a small
  // crop; the plan's crop versus destination records whether enlargement happened.
  fit: z.enum(["COVER", "CONTAIN", "COVER_ALLOW_ENLARGE"]),
  focalPoint: mediaFocalPointSchema,
});

type Size = z.infer<typeof sizeSchema>;
type Rectangle = z.infer<typeof rectangleSchema>;

function rectangleFits(rectangle: Rectangle, bounds: Size): boolean {
  return (
    rectangle.width <= bounds.width &&
    rectangle.height <= bounds.height &&
    rectangle.x <= bounds.width - rectangle.width &&
    rectangle.y <= bounds.height - rectangle.height
  );
}

function sameSize(left: Size, right: Size): boolean {
  return left.width === right.width && left.height === right.height;
}

function roundedRatio(numerator: bigint, denominator: bigint): number {
  return Number((2n * numerator + denominator) / (2n * denominator));
}

const planShapeSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  request: mediaFramingRequestSchema,
  target: sizeSchema,
  sourceCrop: rectangleSchema,
  destination: rectangleSchema,
  background: z.enum(["NONE", "NEUTRAL"]),
});

export const mediaFramingPlanSchema = planShapeSchema
  .superRefine((plan, context) => {
    // Zod can continue after scalar refinements such as positive(). Geometry
    // requires all structural checks to pass before division or BigInt casts.
    if (!planShapeSchema.safeParse(plan).success) {
      return;
    }
    const { request, target, sourceCrop, destination } = plan;
    const reject = (path: string, message: string): void => {
      context.addIssue({ code: "custom", path: [path], message });
    };
    if (!sameSize(target, MEDIA_FRAMING_MASTER_SIZES[request.role])) {
      reject(
        "target",
        "target must retain the role's qualified master dimensions",
      );
    }
    if (
      !rectangleFits(sourceCrop, {
        width: request.sourceWidth,
        height: request.sourceHeight,
      })
    ) {
      reject("sourceCrop", "crop must stay within the corrected source pixels");
    }
    if (!rectangleFits(destination, target)) {
      reject("destination", "placement must stay within the master canvas");
    }
    if (
      request.fit !== "COVER_ALLOW_ENLARGE" &&
      (destination.width > sourceCrop.width ||
        destination.height > sourceCrop.height)
    ) {
      reject("destination", "source pixels must never be enlarged");
    }

    if (request.fit === "COVER" || request.fit === "COVER_ALLOW_ENLARGE") {
      if (plan.background !== "NONE") {
        reject("background", "a covering image does not require letterboxing");
      }
      if (
        destination.x !== 0 ||
        destination.y !== 0 ||
        !sameSize(destination, target)
      ) {
        reject("destination", "cover must fill the entire master canvas");
      }
      if (
        BigInt(sourceCrop.width) * BigInt(target.height) !==
        BigInt(sourceCrop.height) * BigInt(target.width)
      ) {
        reject(
          "sourceCrop",
          "cover crop and output must have the same aspect ratio",
        );
      }
      return;
    }

    if (plan.background !== "NEUTRAL") {
      reject("background", "contain requires a semantic neutral background");
    }
    if (
      sourceCrop.x !== 0 ||
      sourceCrop.y !== 0 ||
      sourceCrop.width !== request.sourceWidth ||
      sourceCrop.height !== request.sourceHeight
    ) {
      reject("sourceCrop", "contain must retain the complete source image");
    }
    // One uniform scale determines the image. Only the final pixel grid rounds.
    const widthLimited =
      BigInt(request.sourceWidth) * BigInt(target.height) >=
      BigInt(request.sourceHeight) * BigInt(target.width);
    const originalFits =
      request.sourceWidth <= target.width &&
      request.sourceHeight <= target.height;
    const expectedWidth = originalFits
      ? request.sourceWidth
      : widthLimited
        ? target.width
        : roundedRatio(
            BigInt(request.sourceWidth) * BigInt(target.height),
            BigInt(request.sourceHeight),
          );
    const expectedHeight = originalFits
      ? request.sourceHeight
      : widthLimited
        ? roundedRatio(
            BigInt(request.sourceHeight) * BigInt(target.width),
            BigInt(request.sourceWidth),
          )
        : target.height;
    if (
      destination.width !== expectedWidth ||
      destination.height !== expectedHeight
    ) {
      reject(
        "destination",
        "contain must use a single aspect-preserving scale rounded to pixels",
      );
    }
    if (
      destination.x !== Math.floor((target.width - destination.width) / 2) ||
      destination.y !== Math.floor((target.height - destination.height) / 2)
    ) {
      reject(
        "destination",
        "contain must center the complete image in its canvas",
      );
    }
  })
  .meta({
    "x-runtime-invariants": [
      "source dimensions describe pixels after EXIF orientation correction",
      "plan binds the original asset, metadata revision, checksum, role, fit and focal point",
      "master canvas dimensions are fixed by role; COVER and CONTAIN plans never enlarge source pixels",
      "COVER_ALLOW_ENLARGE fills the canvas like COVER and may enlarge a crop smaller than the canvas",
      "contain retains the complete source and uses one uniform scale rounded to integer raster pixels",
      "a framing plan is deterministic geometry, not evidence of completed media processing or publication",
    ],
  });

const tooSmallErrorSchema = z
  .strictObject({
    code: z.literal("SOURCE_TOO_SMALL"),
    role: roleSchema,
    minimumTarget: sizeSchema,
  })
  .superRefine((error, context) => {
    if (
      !sameSize(error.minimumTarget, MEDIA_FRAMING_MASTER_SIZES[error.role])
    ) {
      context.addIssue({
        code: "custom",
        path: ["minimumTarget"],
        message:
          "resolution failure must identify the role's qualified master dimensions",
      });
    }
  });

export const mediaFramingResultSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    outcome: z.literal("SUCCESS"),
    plan: mediaFramingPlanSchema,
  }),
  z.strictObject({
    schemaVersion: schemaVersionSchema,
    outcome: z.literal("FAILURE"),
    error: z.union([
      z.strictObject({ code: z.literal("INVALID_REQUEST") }),
      tooSmallErrorSchema,
    ]),
  }),
]);

export type MediaFramingRequest = z.infer<typeof mediaFramingRequestSchema>;
export type MediaFramingPlan = z.infer<typeof mediaFramingPlanSchema>;
export type MediaFramingResult = z.infer<typeof mediaFramingResultSchema>;
