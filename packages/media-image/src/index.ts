import type {
  MediaImageProcessingPort,
  MediaStoragePort,
} from "@fan-support/media-port";
import {
  MEDIA_IMAGE_PROFILE,
  mediaImageProcessingCommandSchema,
  mediaImageProcessingSuccessSchema,
  type MediaImageProcessingSuccess,
} from "@fan-support/contracts";
import {
  hashMediaProcessingCommand,
  validateMediaProcessingReceipt,
} from "@fan-support/content";
import {
  ProcessingBudget,
  ProcessingFailure,
  processingError,
} from "./failure.js";
import { createImageMaster, createImageVariant } from "./image-pipeline.js";
import { createStorageTransfer } from "./storage-transfer.js";

export interface MediaImageProcessorOptions {
  storage: MediaStoragePort;
  now: () => Date;
  fetch?: typeof globalThis.fetch;
  requestTimeoutMs?: number;
  processingTimeoutSeconds?: number;
}

export function createMediaImageProcessor(
  options: MediaImageProcessorOptions,
): MediaImageProcessingPort {
  const requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
  const processingTimeoutSeconds = options.processingTimeoutSeconds ?? 30;
  if (
    !Number.isInteger(requestTimeoutMs) ||
    requestTimeoutMs < 1 ||
    requestTimeoutMs > 60_000 ||
    !Number.isInteger(processingTimeoutSeconds) ||
    processingTimeoutSeconds < 1 ||
    processingTimeoutSeconds > 60
  )
    throw new Error("Invalid media image processor options");
  return {
    async process(input) {
      try {
        const parsed = mediaImageProcessingCommandSchema.safeParse(input);
        if (!parsed.success) throw new ProcessingFailure("INVALID_COMMAND");
        const command = parsed.data;
        const budget = new ProcessingBudget(
          requestTimeoutMs,
          processingTimeoutSeconds,
        );
        return await budget.run(async () => {
          const transfer = createStorageTransfer(
            options.storage,
            options.fetch ?? globalThis.fetch,
            options.now,
            budget,
          );
          const bytes = await transfer.download(command);
          const master = await createImageMaster(bytes, command, budget);
          await transfer.upload(master.bytes, {
            ...master.descriptor,
            storageClass: "SOURCE",
          });
          const variants: MediaImageProcessingSuccess["variants"] = [];
          for (const format of MEDIA_IMAGE_PROFILE.formats) {
            for (const width of [
              ...MEDIA_IMAGE_PROFILE.responsiveWidths,
              master.descriptor.width,
            ]) {
              const variant = await createImageVariant(
                master,
                format,
                width,
                budget,
              );
              await transfer.upload(variant.bytes, {
                ...variant.descriptor,
                mimeType: `image/${format.toLowerCase()}` as
                  "image/avif" | "image/webp" | "image/jpeg",
                storageClass: "DERIVATIVE",
              });
              variants.push(variant.descriptor);
            }
          }
          budget.remainingMs();
          const result = mediaImageProcessingSuccessSchema.parse({
            schemaVersion: 1,
            outcome: "SUCCESS",
            commandHash: hashMediaProcessingCommand(command),
            profileVersion: 1,
            orientation: master.orientation,
            plan: master.plan,
            metadataPolicy: MEDIA_IMAGE_PROFILE.metadataPolicy,
            master: master.descriptor,
            variants,
          });
          if (!validateMediaProcessingReceipt(command, result))
            throw new ProcessingFailure("UNEXPECTED_PROCESSING_FAILURE");
          return result;
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

export {
  createMediaSourceInspector,
  type MediaSourceInspectorOptions,
} from "./source-inspection.js";
export {
  createDeliveryProofProcessor,
  createDeliveryProofReader,
  type DeliveryProofMediaOptions,
} from "./delivery-proof.js";
