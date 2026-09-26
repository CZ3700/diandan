import { randomBytes } from "node:crypto";
import {
  createManagementCenterWorker,
  createManagementMediaPreparation,
  type ManagementCenterWorkerResult,
} from "@fan-support/application";
import {
  resolveDatabaseRuntimeConfig,
  resolveObjectStorageRuntimeConfig,
} from "@fan-support/config/server";
import { createMediaSourceInspector } from "@fan-support/media-image";
import { createS3MediaStorageAdapter } from "@fan-support/media-s3";
import type { StructuredLogger } from "@fan-support/observability";
import { createPostgresPersistence } from "@fan-support/persistence-postgres";

import {
  createPollingWorkerRuntime,
  type PollingWorkerRuntime,
} from "./polling-worker-runtime.js";

export type WorkerManagementCenterComposition = Readonly<{
  start(): Promise<void>;
  stop(): Promise<void>;
}>;

export type WorkerManagementCenterCompositionFactories = Readonly<{
  createPersistence: typeof createPostgresPersistence;
  createStorage: typeof createS3MediaStorageAdapter;
  createInspector: typeof createMediaSourceInspector;
  createRuntime: typeof createPollingWorkerRuntime<ManagementCenterWorkerResult>;
  createLeaseToken(): string;
  now(): Date;
}>;

export class WorkerManagementCenterCompositionError extends Error {
  public constructor(
    public readonly code: "CONSTRUCTION_FAILED" | "STOP_FAILED",
  ) {
    super("Worker management center composition failed");
    this.name = "WorkerManagementCenterCompositionError";
  }
}

// Preparation inspects uploaded sources before publishing; the lease outlasts that budget.
const LEASE_SECONDS = 300;
const POLL_INTERVAL_MS = 1_000;

/** Publishes management-center submissions: prepares their media, then applies the publication. */
export async function createWorkerManagementCenterComposition(
  environment: Readonly<Record<string, string | undefined>>,
  options: Readonly<{
    logger?: StructuredLogger;
    factories?: Partial<WorkerManagementCenterCompositionFactories>;
  }> = {},
): Promise<WorkerManagementCenterComposition> {
  const database = resolveDatabaseRuntimeConfig({ environment });
  const storageConfig = resolveObjectStorageRuntimeConfig({ environment });
  const { logger } = options;
  const factories: WorkerManagementCenterCompositionFactories = {
    createPersistence:
      options.factories?.createPersistence ?? createPostgresPersistence,
    createStorage:
      options.factories?.createStorage ?? createS3MediaStorageAdapter,
    createInspector:
      options.factories?.createInspector ?? createMediaSourceInspector,
    createRuntime:
      options.factories?.createRuntime ?? createPollingWorkerRuntime,
    createLeaseToken:
      options.factories?.createLeaseToken ??
      (() => randomBytes(32).toString("hex")),
    now: options.factories?.now ?? (() => new Date()),
  };
  let persistence: ReturnType<typeof createPostgresPersistence> | undefined;
  try {
    const storage = factories.createStorage(storageConfig);
    const inspector = factories.createInspector({
      storage,
      now: factories.now,
    });
    persistence = factories.createPersistence(
      {
        connectionString: database.url,
        application_name: "fan-support-management-worker",
      },
      logger === undefined
        ? undefined
        : {
            onInfrastructureFailure: (notice) =>
              logger.error("persistence.pool_failure", {
                errorCode: notice.code,
                outcome: "failure",
              }),
          },
    );
    const ownedPersistence = persistence;
    const worker = createManagementCenterWorker({
      transactions: persistence.managementCenterTransactionManager,
      media: createManagementMediaPreparation({
        transactions: persistence.managementMediaTransactionManager,
        inspector,
      }),
      leaseSeconds: LEASE_SECONDS,
      createLeaseToken: factories.createLeaseToken,
    });
    const runtime: PollingWorkerRuntime = factories.createRuntime({
      pollIntervalMs: POLL_INTERVAL_MS,
      processNext: () => worker.processNext(),
      fallback: "UNAVAILABLE",
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
            throw new WorkerManagementCenterCompositionError("STOP_FAILED");
        })();
        return stopPromise;
      },
    });
  } catch {
    await persistence?.close().catch(() => undefined);
    throw new WorkerManagementCenterCompositionError("CONSTRUCTION_FAILED");
  }
}
