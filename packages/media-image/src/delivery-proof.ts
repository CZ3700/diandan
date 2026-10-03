import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  DELIVERY_PROOF_PROFILE,
  deliveryProofProcessingCommandSchema,
  deliveryProofProcessingSuccessSchema,
  deliveryProofReadCommandSchema,
  deliveryProofRenditionObjectKey,
  sourceHashSchema,
  type DeliveryProofRendition,
  type DeliveryProofRenditionName,
} from "@fan-support/contracts";
import type {
  DeliveryProofProcessingPort,
  DeliveryProofReadPort,
  MediaStoragePort,
} from "@fan-support/media-port";
import {
  ProcessingBudget,
  ProcessingFailure,
  processingError,
} from "./failure.js";
import {
  codec,
  decodeSourcePixels,
  readSourceImageMetadata,
} from "./image-pipeline.js";
import { createStorageTransfer } from "./storage-transfer.js";

export interface DeliveryProofMediaOptions {
  storage: MediaStoragePort;
  now: () => Date;
  fetch?: typeof globalThis.fetch;
}
// The admin BFF gives the API 30 s; finishing earlier lets a lost response be retried safely.
const PROCESS_TOTAL_MS = 25_000;
const READ_TOTAL_MS = 15_000;
const REQUEST_TIMEOUT_MS = 10_000;
const CODEC_TIMEOUT_SECONDS = 20;

type Pixels = Awaited<ReturnType<typeof decodeSourcePixels>>;
async function encodeRendition(
  pixels: Pixels,
  name: DeliveryProofRenditionName,
  uploadId: string,
  budget: ProcessingBudget,
): Promise<{ bytes: Buffer; descriptor: DeliveryProofRendition }> {
  const limits = DELIVERY_PROOF_PROFILE.renditions[name];
  const { width, height } = pixels.info;
  const scale = Math.min(1, limits.maxEdge / Math.max(width, height));
  const target = {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
  // Encoded from metadata-free sRGB pixels: no EXIF, GPS, XMP or ICC data can survive.
  const bytes = await codec(() =>
    sharp(pixels.data, {
      raw: { width, height, channels: 3 },
      limitInputPixels: DELIVERY_PROOF_PROFILE.sourcePixelLimit,
    })
      .timeout({ seconds: budget.codecSeconds() })
      .resize(target.width, target.height, { fit: "fill" })
      .webp({ quality: limits.quality, effort: 4 })
      .toBuffer(),
  );
  if (bytes.length === 0 || bytes.length > limits.byteLimit)
    throw new ProcessingFailure("OUTPUT_LIMIT_EXCEEDED");
  const checksumSha256 = sourceHashSchema.parse(
    createHash("sha256").update(bytes).digest("hex"),
  );
  return {
    bytes,
    descriptor: {
      objectKey: deliveryProofRenditionObjectKey(uploadId, checksumSha256),
      checksumSha256,
      byteSize: bytes.length,
      width: target.width,
      height: target.height,
      mimeType: "image/webp",
    },
  };
}

/** Private delivery evidence: every write targets the SOURCE bucket's proof namespace. */
export function createDeliveryProofProcessor(
  options: DeliveryProofMediaOptions,
): DeliveryProofProcessingPort {
  return {
    async process(input) {
      try {
        const parsed = deliveryProofProcessingCommandSchema.safeParse(input);
        if (!parsed.success) throw new ProcessingFailure("INVALID_COMMAND");
        const command = parsed.data;
        const budget = new ProcessingBudget(
          REQUEST_TIMEOUT_MS,
          CODEC_TIMEOUT_SECONDS,
          PROCESS_TOTAL_MS,
        );
        return await budget.run(async () => {
          const transfer = createStorageTransfer(
            options.storage,
            options.fetch ?? globalThis.fetch,
            options.now,
            budget,
          );
          const bytes = await transfer.download(command);
          const metadata = await readSourceImageMetadata(
            bytes,
            command.source.mimeType,
            budget,
          );
          if (
            Math.min(metadata.width, metadata.height) <
            DELIVERY_PROOF_PROFILE.minimumSourceEdge
          )
            throw new ProcessingFailure("SOURCE_TOO_SMALL");
          const pixels = await decodeSourcePixels(bytes, metadata, budget);
          const display = await encodeRendition(
            pixels,
            "display",
            command.uploadId,
            budget,
          );
          const thumbnail = await encodeRendition(
            pixels,
            "thumbnail",
            command.uploadId,
            budget,
          );
          for (const rendition of [display, thumbnail])
            await transfer.upload(rendition.bytes, {
              ...rendition.descriptor,
              storageClass: "SOURCE",
            });
          budget.remainingMs();
          return deliveryProofProcessingSuccessSchema.parse({
            schemaVersion: 1,
            outcome: "SUCCESS",
            profileVersion: 1,
            uploadId: command.uploadId,
            metadataPolicy: DELIVERY_PROOF_PROFILE.metadataPolicy,
            display: display.descriptor,
            thumbnail: thumbnail.descriptor,
          });
        });
      } catch (error) {
        return {
          schemaVersion: 1,
          outcome: "FAILURE",
          error: processingError(error),
        };
      }
    },
  };
}

/** Reads one already-authorized rendition and verifies its exact checksum and length. */
export function createDeliveryProofReader(
  options: DeliveryProofMediaOptions,
): DeliveryProofReadPort {
  return {
    async read(input) {
      const parsed = deliveryProofReadCommandSchema.safeParse(input);
      if (!parsed.success) return { outcome: "FAILURE", code: "UNAVAILABLE" };
      const { rendition } = parsed.data;
      const budget = new ProcessingBudget(
        REQUEST_TIMEOUT_MS,
        CODEC_TIMEOUT_SECONDS,
        READ_TOTAL_MS,
      );
      try {
        const bytes = await budget.run(() =>
          createStorageTransfer(
            options.storage,
            options.fetch ?? globalThis.fetch,
            options.now,
            budget,
          ).download({
            source: {
              objectKey: rendition.objectKey,
              checksumSha256: rendition.checksumSha256,
              byteSize: rendition.byteSize,
              mimeType: rendition.mimeType,
            },
          }),
        );
        return { outcome: "SUCCESS", bytes: new Uint8Array(bytes) };
      } catch (error) {
        return error instanceof ProcessingFailure &&
          error.code === "SOURCE_NOT_FOUND"
          ? { outcome: "FAILURE", code: "NOT_FOUND" }
          : { outcome: "FAILURE", code: "UNAVAILABLE" };
      }
    },
  };
}
