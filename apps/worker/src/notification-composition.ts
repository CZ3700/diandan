import { createOrderNotificationUseCases } from "@fan-support/application";
import {
  notificationRuntimeConfigurationSchema,
  orderAccessConfigurationSchema,
} from "@fan-support/contracts";
import { resolveServerRuntimeConfig } from "@fan-support/config/server";
import { createOrderNotificationTemplates } from "@fan-support/i18n/notifications";
import { createKmsKeyManagementAdapter } from "@fan-support/key-management-kms";
import type { KeyManagementPort } from "@fan-support/key-management-port";
import { createNotificationGatewayTransport } from "@fan-support/notification-provider";
import type { StructuredLogger } from "@fan-support/observability";
import type { NotificationTransactionManager } from "@fan-support/persistence-port";
import {
  resolveNotificationKms,
  workerNotificationConfigurationSchema,
  type WorkerNotificationConfiguration,
} from "./notification-config.js";

type Environment = Readonly<Record<string, string | undefined>>;
type Dependencies = Readonly<{
  notificationTransactionManager: NotificationTransactionManager;
  logger?: StructuredLogger;
}>;
type Injected = Readonly<{
  configuration: WorkerNotificationConfiguration;
  credentials: Environment;
  transactions: NotificationTransactionManager;
  keyManagement: KeyManagementPort;
  logger?: StructuredLogger;
  transportFactory?: typeof createNotificationGatewayTransport;
}>;
function prepare(
  options: Omit<Injected, "transactions" | "logger">,
  mode: "TEST_DRAFT" | "APPROVED",
) {
  const config = workerNotificationConfigurationSchema.parse(
    options.configuration,
  );
  const templates = createOrderNotificationTemplates({
    mode,
    incidentFallbackLocales: config.incidentFallbackLocales,
  });
  const resolvedProfiles = config.profiles.map((entry) => {
    const credential = options.credentials[entry.credentialEnvironmentVariable];
    if (
      typeof credential !== "string" ||
      credential.length < 16 ||
      credential.length > 4096 ||
      /[^\x21-\x7e]/u.test(credential)
    ) {
      throw new TypeError("Invalid notification worker configuration");
    }
    return { entry, credential };
  });
  const profiles = resolvedProfiles.map(({ entry, credential }) => ({
    name: entry.name,
    profile: entry.profile,
    ...(options.transportFactory ?? createNotificationGatewayTransport)({
      profile: entry.profile,
      resolveCredential: async () => credential,
    }),
  }));
  const active = profiles.find((p) => p.name === config.activeProfile)!;
  const configuration = notificationRuntimeConfigurationSchema.parse({
    schemaVersion: 1,
    siteName: config.siteName,
    publicStorefrontOrigin: config.publicStorefrontOrigin,
    transportKey: active.transportKey,
    linkPepperVersion: config.linkPepperVersion,
    linkTtlSeconds: config.linkTtlSeconds,
    // Derive the permitted window from the exact frozen transport profile. No independent override.
    idempotencyRetentionSeconds: active.profile.idempotencyRetentionSeconds,
    leaseSeconds: config.leaseSeconds,
    retryDelaySeconds: config.retryDelaySeconds,
    maxAttempts: config.maxAttempts,
  });
  const transports = new Map(
    profiles.map((p) => [p.transportKey, p.transport]),
  );
  return (dependencies: Dependencies) =>
    createOrderNotificationUseCases({
      transactions: dependencies.notificationTransactionManager,
      keyManagement: options.keyManagement,
      templates,
      configuration,
      transportForKey: (key) => transports.get(key),
      onNotice: (code) =>
        dependencies.logger?.warn("order_notification.notice", {
          errorCode: code,
          outcome: "failure",
        }),
    });
}
/** Explicit TEST composition for local fixtures. It cannot choose a LIVE sender or production approval. */
export function createTestWorkerNotifications(
  options: Injected & { environment: "TEST" },
) {
  const config = workerNotificationConfigurationSchema.safeParse(
    options.configuration,
  );
  if (
    options.environment !== "TEST" ||
    !config.success ||
    config.data.profiles.some((p) => p.profile.environment !== "TEST")
  )
    throw new TypeError("Invalid TEST notification configuration");
  return prepare(
    { ...options, configuration: config.data },
    "TEST_DRAFT",
  )({
    notificationTransactionManager: options.transactions,
    ...(options.logger ? { logger: options.logger } : {}),
  });
}
/** Configuration is inert unless explicitly supplied. DRAFT mail can never activate this production path. */
export function prepareOptionalWorkerNotifications(environment: Environment) {
  const value = environment["FAN_SUPPORT_NOTIFICATION_CONFIG_JSON"];
  if (value === undefined) return undefined;
  try {
    if (value.length > 131072) throw new Error("Invalid configuration");
    const configuration = workerNotificationConfigurationSchema.parse(
      JSON.parse(value) as unknown,
    );
    const accessText = environment["FAN_SUPPORT_ORDER_ACCESS_CONFIG_JSON"];
    if (!accessText || accessText.length > 16384)
      throw new Error("Order access configuration missing");
    const access = orderAccessConfigurationSchema.parse(
      JSON.parse(accessText) as unknown,
    );
    const keys = resolveNotificationKms(environment);
    const accepted = Object.keys(keys.blindIndexKeyIdsByVersion).sort();
    if (
      configuration.publicStorefrontOrigin !==
        resolveServerRuntimeConfig({ environment }).siteOrigin ||
      access.publicStorefrontOrigin !== configuration.publicStorefrontOrigin ||
      configuration.linkTtlSeconds > access.linkTtlSeconds ||
      JSON.stringify(accepted) !==
        JSON.stringify([...configuration.acceptedPepperVersions].sort()) ||
      keys.activeBlindIndexKeyVersion !== configuration.linkPepperVersion
    )
      throw new Error("Notification and access configuration disagree");
    return prepare(
      {
        configuration,
        credentials: environment,
        keyManagement: createKmsKeyManagementAdapter(keys),
      },
      "APPROVED",
    );
  } catch {
    throw new TypeError("Invalid notification worker configuration");
  }
}

export function createOptionalWorkerNotifications(
  environment: Environment,
  dependencies: Dependencies,
) {
  return prepareOptionalWorkerNotifications(environment)?.(dependencies);
}
