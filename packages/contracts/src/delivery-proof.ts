import { z } from "zod";
import { sourceHashSchema } from "./content-lifecycle.js";
import { mediaObjectKeySchema } from "./media-content.js";
import {
  MEDIA_IMAGE_PROFILE,
  mediaProcessingErrorSchema,
} from "./media-processing.js";

const uuid = z.uuid();
const version = z.literal(1);

/**
 * V2 §4-6: delivery proofs are private order evidence. Every object lives in the private
 * SOURCE bucket under this namespace and never in the CDN-readable DERIVATIVE bucket.
 */
export const DELIVERY_PROOF_PROFILE = Object.freeze({
  version: 1 as const,
  namespace: "fulfillment-proofs/v1" as const,
  maxActiveProofsPerLine: 3,
  sourceByteLimit: MEDIA_IMAGE_PROFILE.sourceByteLimit,
  sourcePixelLimit: MEDIA_IMAGE_PROFILE.sourcePixelLimit,
  minimumSourceEdge: 320,
  metadataPolicy: "STRIP_ALL_SRGB" as const,
  renditions: Object.freeze({
    display: Object.freeze({
      maxEdge: 1600,
      quality: 82,
      byteLimit: 4 * 1024 * 1024,
    }),
    thumbnail: Object.freeze({
      maxEdge: 480,
      quality: 76,
      byteLimit: 512 * 1024,
    }),
  }),
});

export const deliveryProofRenditionNameSchema = z.enum([
  "thumbnail",
  "display",
]);
export const deliveryProofSourceMimeTypeSchema = z.enum([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** The server assigns every source key; browsers never choose storage paths. */
export function deliveryProofSourceObjectKey(uploadId: string) {
  return mediaObjectKeySchema.parse(
    `${DELIVERY_PROOF_PROFILE.namespace}/sources/${uuid.parse(uploadId).toLowerCase()}`,
  );
}
/** Content-addressed under the upload, so a retried encode never collides with earlier bytes. */
export function deliveryProofRenditionObjectKey(
  uploadId: string,
  checksumSha256: string,
) {
  return mediaObjectKeySchema.parse(
    `${DELIVERY_PROOF_PROFILE.namespace}/renditions/${uuid.parse(uploadId).toLowerCase()}/${sourceHashSchema.parse(checksumSha256)}.webp`,
  );
}

export const deliveryProofSourceSchema = z.strictObject({
  objectKey: mediaObjectKeySchema,
  checksumSha256: sourceHashSchema,
  byteSize: z.number().int().min(1).max(DELIVERY_PROOF_PROFILE.sourceByteLimit),
  mimeType: deliveryProofSourceMimeTypeSchema,
});
const edge = z
  .number()
  .int()
  .min(1)
  .max(DELIVERY_PROOF_PROFILE.renditions.display.maxEdge);
export const deliveryProofRenditionSchema = z.strictObject({
  objectKey: mediaObjectKeySchema,
  checksumSha256: sourceHashSchema,
  byteSize: z
    .number()
    .int()
    .min(1)
    .max(DELIVERY_PROOF_PROFILE.renditions.display.byteLimit),
  width: edge,
  height: edge,
  mimeType: z.literal("image/webp"),
});

export const deliveryProofProcessingCommandSchema = z
  .strictObject({
    schemaVersion: version,
    profileVersion: z.literal(1),
    uploadId: uuid,
    source: deliveryProofSourceSchema,
  })
  .refine(
    (value) =>
      value.source.objectKey === deliveryProofSourceObjectKey(value.uploadId),
    { message: "Proof sources use their server-assigned key" },
  );
export const deliveryProofProcessingSuccessSchema = z
  .strictObject({
    schemaVersion: version,
    outcome: z.literal("SUCCESS"),
    profileVersion: z.literal(1),
    uploadId: uuid,
    metadataPolicy: z.literal(DELIVERY_PROOF_PROFILE.metadataPolicy),
    display: deliveryProofRenditionSchema,
    thumbnail: deliveryProofRenditionSchema,
  })
  .superRefine((value, context) => {
    for (const name of deliveryProofRenditionNameSchema.options) {
      const rendition = value[name],
        limits = DELIVERY_PROOF_PROFILE.renditions[name];
      if (
        rendition.objectKey !==
          deliveryProofRenditionObjectKey(
            value.uploadId,
            rendition.checksumSha256,
          ) ||
        Math.max(rendition.width, rendition.height) > limits.maxEdge ||
        rendition.byteSize > limits.byteLimit
      )
        context.addIssue({
          code: "custom",
          path: [name],
          message:
            "Each rendition is bounded and stored under its upload's private key",
        });
    }
    if (
      value.thumbnail.width > value.display.width ||
      value.thumbnail.height > value.display.height
    )
      context.addIssue({
        code: "custom",
        path: ["thumbnail"],
        message: "Thumbnails never exceed the display rendition",
      });
  });
export const deliveryProofProcessingResultSchema = z.union([
  deliveryProofProcessingSuccessSchema,
  z.strictObject({
    schemaVersion: version,
    outcome: z.literal("FAILURE"),
    error: mediaProcessingErrorSchema,
  }),
]);
/** Only called after the caller authorized the exact proof; returns verified bytes. */
export const deliveryProofReadCommandSchema = z.strictObject({
  schemaVersion: version,
  rendition: deliveryProofRenditionSchema,
});

export type DeliveryProofRenditionName = z.infer<
  typeof deliveryProofRenditionNameSchema
>;
export type DeliveryProofSource = z.infer<typeof deliveryProofSourceSchema>;
export type DeliveryProofRendition = z.infer<
  typeof deliveryProofRenditionSchema
>;
export type DeliveryProofProcessingCommand = z.infer<
  typeof deliveryProofProcessingCommandSchema
>;
export type DeliveryProofProcessingSuccess = z.infer<
  typeof deliveryProofProcessingSuccessSchema
>;
export type DeliveryProofProcessingResult = z.infer<
  typeof deliveryProofProcessingResultSchema
>;
export type DeliveryProofReadCommand = z.infer<
  typeof deliveryProofReadCommandSchema
>;
