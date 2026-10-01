import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  STOREFRONT_LOGO_PROFILE,
  storefrontLogoProcessingCommandSchema,
  storefrontLogoProcessingResultSchema,
  storefrontLogoObjectKey,
  sourceHashSchema,
} from "@fan-support/contracts";
import type {
  MediaStoragePort,
  StorefrontLogoProcessingPort,
} from "@fan-support/media-port";
import {
  ProcessingBudget,
  ProcessingFailure,
  processingError,
} from "./failure.js";
import { codec, readSourceImageMetadata } from "./image-pipeline.js";
import { createStorageTransfer } from "./storage-transfer.js";

export interface StorefrontLogoMediaOptions {
  storage: MediaStoragePort;
  now: () => Date;
  fetch?: typeof globalThis.fetch;
}

/** Logo-specific processing preserves alpha and aspect ratio; photo profiles stay unchanged. */
export function createStorefrontLogoProcessor(
  options: StorefrontLogoMediaOptions,
): StorefrontLogoProcessingPort {
  return {
    async process(input) {
      try {
        const parsed = storefrontLogoProcessingCommandSchema.safeParse(input);
        if (!parsed.success) throw new ProcessingFailure("INVALID_COMMAND");
        const command = parsed.data;
        // Stay within the administrative request budget, allowing safe retry after a lost reply.
        const budget = new ProcessingBudget(10_000, 20, 25_000);
        return await budget.run(async () => {
          const transfer = createStorageTransfer(
            options.storage,
            options.fetch ?? globalThis.fetch,
            options.now,
            budget,
          );
          const source = await transfer.download(command);
          const metadata = await readSourceImageMetadata(
            source,
            command.source.mimeType,
            budget,
          );
          // Fully decode to metadata-free, oriented sRGB pixels before producing public bytes.
          const pixels = await codec(() =>
            sharp(source, {
              failOn: "warning",
              limitInputPixels: STOREFRONT_LOGO_PROFILE.sourcePixelLimit,
              sequentialRead: true,
            })
              .timeout({ seconds: budget.codecSeconds() })
              .autoOrient()
              .toColourspace("srgb")
              .ensureAlpha()
              .raw()
              .toBuffer({ resolveWithObject: true }),
          );
          const swapped = metadata.orientation >= 5;
          if (
            pixels.info.width !==
              (swapped ? metadata.height : metadata.width) ||
            pixels.info.height !==
              (swapped ? metadata.width : metadata.height) ||
            pixels.info.channels !== 4
          )
            throw new ProcessingFailure("INVALID_IMAGE");
          const encoded = await codec(() =>
            sharp(pixels.data, {
              raw: {
                width: pixels.info.width,
                height: pixels.info.height,
                channels: 4,
              },
              limitInputPixels: STOREFRONT_LOGO_PROFILE.sourcePixelLimit,
            })
              .timeout({ seconds: budget.codecSeconds() })
              .resize({
                width: STOREFRONT_LOGO_PROFILE.maxEdge,
                height: STOREFRONT_LOGO_PROFILE.maxEdge,
                fit: "inside",
                withoutEnlargement: true,
              })
              .webp({ lossless: true, effort: 4 })
              .toBuffer({ resolveWithObject: true }),
          );
          if (
            encoded.data.length === 0 ||
            encoded.data.length > STOREFRONT_LOGO_PROFILE.outputByteLimit
          )
            throw new ProcessingFailure("OUTPUT_LIMIT_EXCEEDED");
          const checksumSha256 = sourceHashSchema.parse(
            createHash("sha256").update(encoded.data).digest("hex"),
          );
          const image = {
            objectKey: storefrontLogoObjectKey(
              command.uploadId,
              checksumSha256,
            ),
            checksumSha256,
            byteSize: encoded.data.length,
            width: encoded.info.width,
            height: encoded.info.height,
            mimeType: "image/webp" as const,
          };
          await transfer.upload(encoded.data, {
            ...image,
            storageClass: "DERIVATIVE",
          });
          budget.remainingMs();
          return storefrontLogoProcessingResultSchema.parse({
            schemaVersion: 1,
            outcome: "SUCCESS",
            profileVersion: 1,
            uploadId: command.uploadId,
            sourceChecksumSha256: command.source.checksumSha256,
            metadataPolicy: STOREFRONT_LOGO_PROFILE.metadataPolicy,
            image,
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
