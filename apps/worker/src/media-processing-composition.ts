import { randomUUID } from "node:crypto";
import { createMediaProcessingUseCases } from "@fan-support/application";
import {
  resolveDatabaseRuntimeConfig,
  resolveObjectStorageRuntimeConfig,
} from "@fan-support/config/server";
import { createMediaImageProcessor } from "@fan-support/media-image";
import { createS3MediaStorageAdapter } from "@fan-support/media-s3";
import type { StructuredLogger } from "@fan-support/observability";
import { createPostgresPersistence } from "@fan-support/persistence-postgres";
import { createMediaProcessingWorkerRuntime } from "./media-processing-runtime.js";

export type WorkerMediaProcessingComposition = Readonly<{
  start(): Promise<void>;
  stop(): Promise<void>;
}>;

export type WorkerMediaProcessingCompositionFactories = Readonly<{
  createPersistence: typeof createPostgresPersistence;
  createStorage: typeof createS3MediaStorageAdapter;
  createProcessor: typeof createMediaImageProcessor;
  createRuntime: typeof createMediaProcessingWorkerRuntime;
  createLeaseToken(): string;
  now(): Date;
}>;

export type WorkerMediaProcessingCompositionOptions = Readonly<{
  logger?: StructuredLogger;
  factories?: Partial<WorkerMediaProcessingCompositionFactories>;
}>;

export class WorkerMediaProcessingCompositionError extends Error {
  public constructor(
    public readonly code: "CONSTRUCTION_FAILED" | "STOP_FAILED",
  ) {
    super("Worker media processing composition failed");
    this.name = "WorkerMediaProcessingCompositionError";
  }
}

export async function createWorkerMediaProcessingComposition(
  environment: Readonly<Record<string, string | undefined>>,
  options: WorkerMediaProcessingCompositionOptions = {},
): Promise<WorkerMediaProcessingComposition> {
  const database = resolveDatabaseRuntimeConfig({ environment });
  const storageConfig = resolveObjectStorageRuntimeConfig({ environment });
  const { logger } = options;
  const factories: WorkerMediaProcessingCompositionFactories = {
    createPersistence:
      options.factories?.createPersistence ?? createPostgresPersistence,
    createStorage:
      options.factories?.createStorage ?? createS3MediaStorageAdapter,
    createProcessor:
      options.factories?.createProcessor ?? createMediaImageProcessor,
    createRuntime:
      options.factories?.createRuntime ?? createMediaProcessingWorkerRuntime,
    createLeaseToken: options.factories?.createLeaseToken ?? randomUUID,
    now: options.factories?.now ?? (() => new Date()),
  };
  let persistence: ReturnType<typeof createPostgresPersistence> | undefined;
  try {
    const storage = factories.createStorage(storageConfig);
    const processor = factories.createProcessor({
      storage,
      now: factories.now,
    });
    persistence = factories.createPersistence(
      {
        connectionString: database.url,
        application_name: "fan-support-media-worker",
      },
      logger === undefined
        ? undefined
        : {
            onInfrastructureFailure: (notice) =>
              logger.error("media_processing.persistence_failure", {
                errorCode: notice.code,
                outcome: "failure",
              }),
          },
    );
    const ownedPersistence = persistence;
    const runtime = factories.createRuntime({
      schemaVersion: 1,
      useCases: createMediaProcessingUseCases({
        transactions: persistence.mediaProcessingTransactionManager,
        processor,
        createLeaseToken: factories.createLeaseToken,
        // The processor's hard deadline is below this lease; PG remains the clock.
        leaseSeconds: 300,
      }),
      pollIntervalMs: 1000,
      ...(logger === undefined
        ? {}
        : {
            onResult: (result) => {
              if (result.outcome === "EMPTY") return;
              if (
                ["UNAVAILABLE", "FAILED", "RETRY_SCHEDULED"].includes(
                  result.outcome,
                )
              )
                logger.warn("media_processing.run", {
                  outcome: result.outcome,
                });
              else
                logger.info("media_processing.run", {
                  outcome: result.outcome,
                });
            },
          }),
    });
    let stopPromise: Promise<void> | undefined;
    return Object.freeze({
      start: () => runtime.start(),
      stop() {
        stopPromise ??= (async () => {
          let failed = false;
          try {
            await runtime.stop();
          } catch {
            failed = true;
          }
          try {
            await ownedPersistence.close();
          } catch {
            failed = true;
          }
          if (failed)
            throw new WorkerMediaProcessingCompositionError("STOP_FAILED");
        })();
        return stopPromise;
      },
    });
  } catch {
    await persistence?.close().catch(() => undefined);
    throw new WorkerMediaProcessingCompositionError("CONSTRUCTION_FAILED");
  }
}
