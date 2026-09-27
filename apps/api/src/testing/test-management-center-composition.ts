import { randomBytes, randomUUID } from "node:crypto";
import {
  createManagementCenterUseCases,
  createHomeLayoutUseCases,
  createManagementCenterWorker,
  createManagementMediaPreparation,
  createResourceManagementUseCases,
  createMediaProcessingUseCases,
} from "@fan-support/application";
import {
  createPostgresPersistence,
  type PostgresConnectionConfig,
  type PostgresPersistence,
  type PostgresPersistenceOptions,
} from "@fan-support/persistence-postgres";
import type {
  MediaImageProcessingPort,
  MediaSourceInspectionPort,
  MediaStoragePort,
} from "@fan-support/media-port";
import type { ManagementCenterRouteDependencies } from "../management-center-route.js";
import type { HomeLayoutRouteDependencies } from "../home-layout-route.js";
import type { ApiLifecycleResource } from "../bootstrap.js";
import { createManagementCenterRuntime } from "./management-center-runtime.js";

type ManagementPersistence = Pick<
  PostgresPersistence,
  | "managementCenterTransactionManager"
  | "homeLayoutTransactionManager"
  | "managementMediaTransactionManager"
  | "resourceManagementTransactionManager"
  | "mediaProcessingTransactionManager"
  | "close"
>;
export type TestManagementCenterCompositionOptions = Readonly<{
  environment: "TEST";
  database: PostgresConnectionConfig;
  tokenPepper: string;
  allowedOrigin: string;
  publicMediaBaseUrl: string;
  storage: MediaStoragePort;
  inspector: MediaSourceInspectionPort;
  processor: MediaImageProcessingPort;
  pollIntervalMs?: number;
  leaseSeconds?: number;
}>;
function validOrigin(value: unknown, httpsOnly: boolean): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.origin === value &&
      (httpsOnly
        ? url.protocol === "https:"
        : ["https:", "http:"].includes(url.protocol))
    );
  } catch {
    return false;
  }
}
/** An explicit local TEST composition. It borrows actual media ports and owns its database and background loop. */
export function createTestManagementCenterComposition(
  options: TestManagementCenterCompositionOptions,
  factories: Readonly<{
    createPersistence?: (
      config: PostgresConnectionConfig,
      options: PostgresPersistenceOptions,
    ) => ManagementPersistence;
  }> = {},
): Readonly<{
  managementCenterRoute: ManagementCenterRouteDependencies;
  homeLayoutRoute: HomeLayoutRouteDependencies;
  managementCenterRuntime: ApiLifecycleResource;
}> {
  const pollIntervalMs = options.pollIntervalMs ?? 250,
    leaseSeconds = options.leaseSeconds ?? 120;
  if (
    options.environment !== "TEST" ||
    typeof options.tokenPepper !== "string" ||
    !/^[a-f0-9]{64}$/u.test(options.tokenPepper) ||
    !validOrigin(options.allowedOrigin, false) ||
    !validOrigin(options.publicMediaBaseUrl, true) ||
    typeof options.storage?.createUploadGrant !== "function" ||
    typeof options.inspector?.inspect !== "function" ||
    typeof options.processor?.process !== "function" ||
    !Number.isInteger(pollIntervalMs) ||
    pollIntervalMs < 10 ||
    pollIntervalMs > 60_000 ||
    !Number.isInteger(leaseSeconds) ||
    leaseSeconds < 60 ||
    leaseSeconds > 900
  )
    throw new TypeError("Invalid TEST management center configuration");
  const persistence = (
    factories.createPersistence ?? createPostgresPersistence
  )(options.database, {
    catalogPublicMediaBaseUrl: options.publicMediaBaseUrl,
  });
  try {
    const resources = createResourceManagementUseCases({
      transactions: persistence.resourceManagementTransactionManager,
      tokenPepper: options.tokenPepper,
      storage: options.storage,
      inspector: options.inspector,
    });
    const useCases = createManagementCenterUseCases({
      transactions: persistence.managementCenterTransactionManager,
      resourceManagement: resources,
      tokenPepper: options.tokenPepper,
    });
    const media = createManagementMediaPreparation({
      transactions: persistence.managementMediaTransactionManager,
      inspector: options.inspector,
    });
    const worker = createManagementCenterWorker({
      transactions: persistence.managementCenterTransactionManager,
      media,
      leaseSeconds,
      createLeaseToken: () => randomBytes(32).toString("hex"),
    });
    const processor = createMediaProcessingUseCases({
      transactions: persistence.mediaProcessingTransactionManager,
      processor: options.processor,
      leaseSeconds,
      createLeaseToken: randomUUID,
    });
    return Object.freeze({
      managementCenterRoute: { allowedOrigin: options.allowedOrigin, useCases },
      homeLayoutRoute: {
        allowedOrigin: options.allowedOrigin,
        useCases: createHomeLayoutUseCases({
          transactions: persistence.homeLayoutTransactionManager,
          tokenPepper: options.tokenPepper,
        }),
      },
      managementCenterRuntime: createManagementCenterRuntime({
        pollIntervalMs,
        processNext: async () => {
          await processor.processNext();
          await worker.processNext();
        },
        close: () => persistence.close(),
      }),
    });
  } catch {
    void Promise.resolve()
      .then(() => persistence.close())
      .catch(() => undefined);
    throw new TypeError("TEST management center construction failed");
  }
}
