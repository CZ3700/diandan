import {
  mediaSourceInspectionCommandSchema,
  mediaSourceInspectionResponseSchema,
} from "@fan-support/contracts";
import type { MediaSourceInspectionPort } from "@fan-support/media-port";
import type { MediaImageProcessorOptions } from "./index.js";
import {
  ProcessingBudget,
  ProcessingFailure,
  processingError,
} from "./failure.js";
import {
  decodeSourcePixels,
  readSourceImageMetadata,
} from "./image-pipeline.js";
import { createStorageTransfer } from "./storage-transfer.js";

export type MediaSourceInspectorOptions = MediaImageProcessorOptions;

export function createMediaSourceInspector(
  options: MediaSourceInspectorOptions,
): MediaSourceInspectionPort {
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
    throw new Error("Invalid media source inspector options");
  return {
    async inspect(input) {
      try {
        const parsed = mediaSourceInspectionCommandSchema.safeParse(input);
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
          const metadata = await readSourceImageMetadata(
            bytes,
            command.source.mimeType,
            budget,
          );
          await decodeSourcePixels(bytes, metadata, budget);
          budget.remainingMs();
          return mediaSourceInspectionResponseSchema.parse({
            schemaVersion: 1,
            outcome: "SUCCESS",
            receipt: {
              schemaVersion: 1,
              profileVersion: 1,
              source: command.source,
              ...metadata,
            },
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
