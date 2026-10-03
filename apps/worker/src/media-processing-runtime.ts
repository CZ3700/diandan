import type { MediaProcessingUseCases } from "@fan-support/application";
import {
  mediaProcessingRunResultSchema,
  type MediaProcessingRunResult,
} from "@fan-support/contracts";

import {
  createPollingWorkerRuntime,
  type PollingWorkerRuntime,
} from "./polling-worker-runtime.js";

export type MediaProcessingWorkerRuntime = PollingWorkerRuntime;

export type MediaProcessingWorkerRuntimeOptions = Readonly<{
  schemaVersion: 1;
  useCases: MediaProcessingUseCases;
  pollIntervalMs: number;
  schedule?: (
    tick: () => void,
    delayMs: number,
  ) => Readonly<{ cancel(): void }>;
  onResult?: (result: MediaProcessingRunResult) => void;
}>;

/** One local claim at a time; PostgreSQL coordinates parallel processes. */
export function createMediaProcessingWorkerRuntime(
  options: MediaProcessingWorkerRuntimeOptions,
): MediaProcessingWorkerRuntime {
  if (
    options.schemaVersion !== 1 ||
    !Number.isInteger(options.pollIntervalMs) ||
    options.pollIntervalMs < 10 ||
    options.pollIntervalMs > 60_000
  ) {
    throw new Error("Invalid media worker configuration");
  }
  return createPollingWorkerRuntime<MediaProcessingRunResult>({
    pollIntervalMs: options.pollIntervalMs,
    processNext: async () =>
      mediaProcessingRunResultSchema.parse(
        await options.useCases.processNext(),
      ),
    fallback: { schemaVersion: 1, outcome: "UNAVAILABLE" },
    ...(options.schedule === undefined ? {} : { schedule: options.schedule }),
    ...(options.onResult === undefined ? {} : { onResult: options.onResult }),
  });
}
