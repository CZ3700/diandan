import { createKmsKeyManagementAdapter } from "@fan-support/key-management-kms";
import type {
  KeyManagementPort,
  SupportIntentKeyPort,
} from "@fan-support/key-management-port";
import { createMediaSourceInspector } from "@fan-support/media-image";
import type {
  MediaSourceInspectionPort,
  MediaStoragePort,
} from "@fan-support/media-port";
import { createS3MediaStorageAdapter } from "@fan-support/media-s3";
import type { StructuredLogger } from "@fan-support/observability";
import {
  createPostgresPersistence,
  type PersistenceFailureNotice,
  type PostgresPersistence,
} from "@fan-support/persistence-postgres";

import type { ApiLifecycleResource } from "./bootstrap.js";
import {
  createPersistenceLeases,
  type PersistenceLeases,
} from "./persistence-leases.js";
import type { ApiProductionConfig } from "./production-config.js";

export type ApiKeyResources = Readonly<{
  keyManagement: KeyManagementPort & SupportIntentKeyPort;
  activePepperVersion: string;
  pepperVersions: readonly string[];
}>;
export type ApiMediaResources = Readonly<{
  storage: MediaStoragePort;
  inspector: MediaSourceInspectionPort;
}>;
export type ApiProductionResources = Readonly<{
  /** The request-serving pool shared by public, commerce and administration use cases. */
  persistence(): PostgresPersistence;
  /** A bounded pool for the payment configuration projection and its administration. */
  paymentConfigurationPersistence(): PostgresPersistence;
  keys: ApiKeyResources | undefined;
  media: ApiMediaResources | undefined;
  /** Stopping returns the owner holds; each pool closes after its last borrower. */
  lifecycle: ApiLifecycleResource;
}>;
export type ApiProductionResourceFactories = Readonly<{
  createPersistence?: typeof createPostgresPersistence;
}>;

/** One process-wide instance per infrastructure client; roles that are never borrowed never open a pool. */
export function createApiProductionResources(
  config: ApiProductionConfig,
  options: Readonly<{
    logger: StructuredLogger;
    factories?: ApiProductionResourceFactories;
  }>,
): ApiProductionResources {
  const createPersistence =
    options.factories?.createPersistence ?? createPostgresPersistence;
  const onInfrastructureFailure = (failure: PersistenceFailureNotice) =>
    options.logger.error("persistence.pool_failure", {
      errorCode: failure.code,
      outcome: "failure",
    });
  const pools: PersistenceLeases<PostgresPersistence>[] = [];
  const lazyPool = (open: () => PostgresPersistence) => {
    let leases: PersistenceLeases<PostgresPersistence> | undefined;
    return (): PostgresPersistence => {
      if (leases === undefined) {
        leases = createPersistenceLeases(open());
        pools.push(leases);
      }
      return leases.lease();
    };
  };
  const persistence = lazyPool(() =>
    createPersistence(
      {
        connectionString: config.databaseUrl,
        application_name: "fan-support-api",
        // Waiting forever for a pooled connection turns overload into hung requests.
        connectionTimeoutMillis: 5_000,
      },
      {
        catalogPublicMediaBaseUrl: config.storage.publicMediaOrigin,
        onInfrastructureFailure,
      },
    ),
  );
  const paymentConfigurationPersistence = lazyPool(() =>
    createPersistence(
      {
        connectionString: config.databaseUrl,
        application_name: "fan-support-api-payment-configuration",
        // The refresh loop runs in every process and must never inherit unbounded defaults.
        connectionTimeoutMillis: 3_000,
        statement_timeout: 5_000,
        query_timeout: 6_000,
      },
      { onInfrastructureFailure },
    ),
  );
  const keyConfig = config.keyManagement;
  const keys =
    keyConfig === undefined
      ? undefined
      : Object.freeze({
          keyManagement: createKmsKeyManagementAdapter(keyConfig),
          activePepperVersion: keyConfig.activeBlindIndexKeyVersion,
          pepperVersions: Object.freeze(
            Object.keys(keyConfig.blindIndexKeyIdsByVersion),
          ),
        });
  const storage =
    config.admin === undefined
      ? undefined
      : createS3MediaStorageAdapter(config.storage);
  const media =
    storage === undefined
      ? undefined
      : Object.freeze({
          storage,
          inspector: createMediaSourceInspector({
            storage,
            now: () => new Date(),
          }),
        });
  let stopping: Promise<void> | undefined;
  return Object.freeze({
    persistence,
    paymentConfigurationPersistence,
    keys,
    media,
    lifecycle: Object.freeze({
      start: async () => undefined,
      stop: () =>
        (stopping ??= Promise.all(pools.map((pool) => pool.release())).then(
          () => undefined,
        )),
    }),
  });
}
