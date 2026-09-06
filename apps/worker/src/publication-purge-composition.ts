import { createPublicationPurgeUseCases } from "@fan-support/application";
import { createCloudFrontCachePurgeAdapter } from "@fan-support/cache-purge-cdn";
import type { CachePurgePort } from "@fan-support/cache-purge-port";
import {
  resolveCachePurgeRuntimeConfig,
  resolveDatabaseRuntimeConfig,
} from "@fan-support/config/server";
import type { StructuredLogger } from "@fan-support/observability";
import {
  createPostgresPersistence,
  type PostgresConnectionConfig,
  type PostgresPersistence,
  type PostgresPersistenceOptions,
} from "@fan-support/persistence-postgres";
import { createPublicationPurgeWorkerRuntime } from "./publication-purge-runtime.js";

type Persistence = Pick<
  PostgresPersistence,
  "publicationPurgeTransactionManager" | "close"
>;
export type WorkerPublicationPurgeComposition = Readonly<{
  start(): Promise<void>;
  stop(): Promise<void>;
}>;
export type WorkerPublicationPurgeCompositionOptions = Readonly<{
  logger?: StructuredLogger;
  factories?: Readonly<{
    createPersistence?: (
      config: PostgresConnectionConfig,
      options?: PostgresPersistenceOptions,
    ) => Persistence;
    createAdapter?: typeof createCloudFrontCachePurgeAdapter;
    createRuntime?: typeof createPublicationPurgeWorkerRuntime;
  }>;
}>;
function unconfiguredAdapter(): CachePurgePort {
  return {
    submitPurge: async () => ({
      schemaVersion: 1,
      operation: "SUBMIT_PURGE",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "CONFIGURATION_ERROR",
        recovery: "NONE",
      },
    }),
    getPurgeStatus: async () => ({
      schemaVersion: 1,
      operation: "GET_PURGE_STATUS",
      outcome: "FAILURE",
      error: {
        schemaVersion: 1,
        code: "CONFIGURATION_ERROR",
        recovery: "NONE",
      },
    }),
  };
}
export async function createWorkerPublicationPurgeComposition(
  environment: Readonly<Record<string, string | undefined>>,
  options: WorkerPublicationPurgeCompositionOptions = {},
): Promise<WorkerPublicationPurgeComposition> {
  const database = resolveDatabaseRuntimeConfig({ environment });
  const config = resolveCachePurgeRuntimeConfig({ environment });
  let persistence: Persistence | undefined;
  try {
    const cachePurge =
      config.provider === "UNCONFIGURED"
        ? unconfiguredAdapter()
        : (
            options.factories?.createAdapter ??
            createCloudFrontCachePurgeAdapter
          )({
            schemaVersion: 1,
            region: config.region,
            distributionId: config.distributionId,
          });
    persistence = (
      options.factories?.createPersistence ?? createPostgresPersistence
    )(
      {
        connectionString: database.url,
        application_name: "fan-support-publication-purge-worker",
      },
      options.logger === undefined
        ? undefined
        : {
            onInfrastructureFailure: (notice) =>
              options.logger!.error("publication_purge.persistence_failure", {
                errorCode: notice.code,
                outcome: "failure",
              }),
          },
    );
    const ownedPersistence = persistence;
    const runtime = (
      options.factories?.createRuntime ?? createPublicationPurgeWorkerRuntime
    )({
      schemaVersion: 1,
      useCases: createPublicationPurgeUseCases({
        transactions: persistence.publicationPurgeTransactionManager,
        cachePurge,
      }),
      pollIntervalMs: 1000,
      onResult: (result) => {
        if (result.outcome === "UNAVAILABLE")
          options.logger?.warn("publication_purge.run", {
            outcome: result.outcome,
          });
        else if (result.outcome === "RECORDED")
          options.logger?.info("publication_purge.run", {
            outcome: result.status,
          });
      },
    });
    let stopPromise: Promise<void> | undefined;
    return Object.freeze({
      start: () => runtime.start(),
      stop() {
        stopPromise ??= (async () => {
          try {
            await runtime.stop();
          } finally {
            await ownedPersistence.close();
          }
        })();
        return stopPromise;
      },
    });
  } catch {
    await persistence?.close().catch(() => undefined);
    throw new Error("Worker publication purge composition failed");
  }
}
