import { createHash } from "node:crypto";
import {
  MEDIA_IMAGE_PROFILE,
  mediaImageProcessingCommandSchema,
  mediaImageProcessingSuccessSchema,
  mediaObjectKeySchema,
  type MediaImageProcessingCommand,
} from "@fan-support/contracts";
import { planMediaFraming } from "./media-framing.js";

export function hashMediaProcessingCommand(input: unknown): string {
  const value = mediaImageProcessingCommandSchema.parse(input);
  return createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: 1,
        profile: MEDIA_IMAGE_PROFILE,
        source: {
          ...value.source,
          assetId: value.source.assetId.toLowerCase(),
          metadataRevisionId: value.source.metadataRevisionId.toLowerCase(),
        },
        role: value.role,
        fit: value.fit,
        focalPoint: value.focalPoint,
      }),
    )
    .digest("hex");
}

export function mediaProcessingObjectKey(
  checksum: string,
  format: "PNG" | "AVIF" | "WEBP" | "JPEG",
  masterChecksum?: string,
) {
  if (!/^[0-9a-f]{64}$/.test(checksum))
    throw new Error("Invalid media checksum");
  const extension = format === "JPEG" ? "jpg" : format.toLowerCase();
  if (format === "PNG")
    return mediaObjectKeySchema.parse(`processed/v1/${checksum}.png`);
  if (!masterChecksum || !/^[0-9a-f]{64}$/.test(masterChecksum))
    throw new Error("Invalid master checksum");
  return mediaObjectKeySchema.parse(
    `processed/v1/${masterChecksum}/${checksum}.${extension}`,
  );
}

/** Revalidates the complete result before persistence; metadata alone grants no publication authority. */
export function validateMediaProcessingReceipt(
  command: MediaImageProcessingCommand,
  input: unknown,
): boolean {
  const parsed = mediaImageProcessingSuccessSchema.safeParse(input);
  if (!parsed.success) return false;
  const value = parsed.data;
  if (value.commandHash !== hashMediaProcessingCommand(command)) return false;
  const swapped = value.orientation >= 5;
  const framing = planMediaFraming({
    schemaVersion: 1,
    assetId: command.source.assetId,
    metadataRevisionId: command.source.metadataRevisionId,
    sourceChecksum: command.source.checksumSha256,
    sourceWidth: swapped ? command.source.height : command.source.width,
    sourceHeight: swapped ? command.source.width : command.source.height,
    role: command.role,
    fit: command.fit,
    focalPoint: command.focalPoint,
  });
  if (
    framing.outcome !== "SUCCESS" ||
    JSON.stringify(framing.plan) !== JSON.stringify(value.plan)
  )
    return false;
  if (
    value.master.objectKey !==
    mediaProcessingObjectKey(value.master.checksumSha256, "PNG")
  )
    return false;
  return value.variants.every(
    (variant) =>
      variant.objectKey ===
      mediaProcessingObjectKey(
        variant.checksumSha256,
        variant.format,
        value.master.checksumSha256,
      ),
  );
}
