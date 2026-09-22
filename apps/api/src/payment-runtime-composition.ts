import { createPaymentRuntimeUseCases } from "@fan-support/application";
import {
  paymentRuntimeConfigurationSchema,
  paymentRuntimeProviderBindingSchema,
  paymentRuntimeOriginSchema,
  paymentHealthPolicySchema,
  type PaymentHealthPolicy,
  type PaymentRuntimeConfiguration,
} from "@fan-support/contracts";
import {
  resolveDatabaseRuntimeConfig,
  resolveObjectStorageRuntimeConfig,
  resolveServerRuntimeConfig,
} from "@fan-support/config/server";
import {
  createKmsKeyManagementAdapter,
  type KmsKeyManagementAdapterConfig,
} from "@fan-support/key-management-kms";
import type { KeyManagementPort } from "@fan-support/key-management-port";
import type {
  PaymentRuntimeProviderRegistration,
  PaymentRuntimeProviderDirectory,
} from "@fan-support/payment-port";
import {
  createPostgresPersistence,
  type PostgresConnectionConfig,
  type PostgresPersistenceOptions,
  type PostgresPersistence,
} from "@fan-support/persistence-postgres";
import { createCartSessionCredentials } from "./cart-session-credentials.js";
import { resolveCartRuntimeConfig } from "./cart-runtime-config.js";
import { createPaymentRecoveryLifecycle } from "./payment-runtime-lifecycle.js";
import type { ApiLifecycleResource } from "./bootstrap.js";
import type { PaymentRuntimeRouteDependencies } from "./payment-runtime-route.js";
type Persistence = Pick<
  PostgresPersistence,
  "paymentRuntimeTransactionManager" | "close"
> & {
  paymentHealthTransactionManager?: PostgresPersistence["paymentHealthTransactionManager"];
};
type Factories = {
  createPersistence?: (
    database: PostgresConnectionConfig,
    options: PostgresPersistenceOptions,
  ) => Persistence;
};
type Common = {
  database: PostgresConnectionConfig;
  publicMediaBaseUrl: string;
  configuration: PaymentRuntimeConfiguration;
  providers: readonly PaymentRuntimeProviderRegistration[];
  providerDirectory?: PaymentRuntimeProviderDirectory;
  healthPolicies?: readonly PaymentHealthPolicy[];
  readHealthPolicies?: () => readonly PaymentHealthPolicy[];
};
type Injected = Common & {
  keyManagement: KeyManagementPort;
  activePepperVersion: string;
  pepperVersions: readonly string[];
};
export type PaymentRuntimeComposition = {
  paymentRuntimeRoute: PaymentRuntimeRouteDependencies;
  paymentRuntime: ApiLifecycleResource;
};
function registrations(
  providers: readonly PaymentRuntimeProviderRegistration[],
) {
  const parsed = providers.map((entry) => ({
    configuration: paymentRuntimeProviderBindingSchema.parse(
      entry.configuration,
    ),
    provider: entry.provider,
  }));
  if (
    parsed.length > 100 ||
    new Set(
      parsed.map((entry) =>
        entry.configuration.providerAccountId.toLowerCase(),
      ),
    ).size !== parsed.length ||
    parsed.some((entry) =>
      [
        "getCapabilities",
        "createPayment",
        "getPayment",
        "cancelPayment",
        "refundPayment",
        "reconcilePayment",
        "reconcileRefund",
      ].some(
        (name) =>
          typeof entry.provider[name as keyof typeof entry.provider] !==
          "function",
      ),
    )
  )
    throw new TypeError("Invalid payment provider registration");
  return parsed;
}
function healthPolicies(
  input: readonly PaymentHealthPolicy[] | undefined,
  providers: readonly PaymentRuntimeProviderRegistration[],
  dynamic = false,
) {
  if (
    !Array.isArray(input) ||
    (input.length === 0 && !dynamic) ||
    input.length > 100
  )
    throw new TypeError("Invalid payment health policies");
  const policies = input.map((value) => paymentHealthPolicySchema.parse(value));
  const identity = (
    value: Pick<PaymentHealthPolicy, "providerAccountId" | "environment">,
  ) => `${value.environment}/${value.providerAccountId.toLowerCase()}`;
  const keys = new Set(policies.map(identity));
  if (
    keys.size !== policies.length ||
    policies.length !== providers.length ||
    providers.some((entry) => !keys.has(identity(entry.configuration)))
  )
    throw new TypeError("Invalid payment health policies");
  return policies;
}
function compose(
  options: Injected,
  factories: Factories,
): PaymentRuntimeComposition {
  const configuration = paymentRuntimeConfigurationSchema.parse(
    options.configuration,
  );
  paymentRuntimeOriginSchema.parse(options.publicMediaBaseUrl);
  const providers = registrations(options.providers);
  const configuredDirectory = options.providerDirectory;
  const providerDirectory =
    configuredDirectory === undefined
      ? undefined
      : {
          getRegistrations: () =>
            registrations(configuredDirectory.getRegistrations()),
        };
  // Validate before creating database resources; the application also guards historical bindings.
  providerDirectory?.getRegistrations();
  if (
    options.readHealthPolicies !== undefined &&
    options.healthPolicies === undefined
  )
    throw new TypeError("Dynamic health requires an initial policy snapshot");
  const policies =
    options.healthPolicies === undefined
      ? undefined
      : healthPolicies(
          options.healthPolicies,
          [...providers, ...(providerDirectory?.getRegistrations() ?? [])],
          options.readHealthPolicies !== undefined,
        );
  const credentials = createCartSessionCredentials(options);
  const persistence = (
    factories.createPersistence ?? createPostgresPersistence
  )(options.database, {
    catalogPublicMediaBaseUrl: options.publicMediaBaseUrl,
  });
  let closed: Promise<void> | undefined;
  const close = () =>
    (closed ??= Promise.resolve().then(() => persistence.close()));
  try {
    if (
      policies !== undefined &&
      persistence.paymentHealthTransactionManager === undefined
    )
      throw new TypeError("Payment health persistence is unavailable");
    const useCases = createPaymentRuntimeUseCases({
      transactions: persistence.paymentRuntimeTransactionManager,
      keyManagement: options.keyManagement,
      providers,
      ...(providerDirectory === undefined ? {} : { providerDirectory }),
      configuration,
      ...(policies === undefined
        ? {}
        : {
            health: {
              policies,
              transactions: persistence.paymentHealthTransactionManager!,
              ...(options.readHealthPolicies === undefined
                ? {}
                : { readPolicies: options.readHealthPolicies }),
            },
          }),
    });
    return Object.freeze({
      paymentRuntimeRoute: {
        allowedOrigin: configuration.publicStorefrontOrigin,
        credentials,
        useCases,
        get actionOrigins() {
          return [
            ...new Set(
              [
                ...providers,
                ...(providerDirectory?.getRegistrations() ?? []),
              ].flatMap((entry) => entry.configuration.allowedActionOrigins),
            ),
          ];
        },
      },
      paymentRuntime: createPaymentRecoveryLifecycle({
        recoverNext: useCases.recoverNext,
        ...(policies === undefined ? {} : { probeNext: useCases.probeNext }),
        close,
        delayMs: configuration.recoveryDelayMs,
        batchSize: configuration.recoveryBatchSize,
      }),
    });
  } catch {
    void close().catch(() => undefined);
    throw new TypeError("Payment runtime construction failed");
  }
}
export function createTestPaymentRuntimeComposition(
  options: Injected & { environment: "TEST" },
  factories: Factories = {},
): PaymentRuntimeComposition {
  if (
    options.environment !== "TEST" ||
    [
      ...options.providers,
      ...(options.providerDirectory?.getRegistrations() ?? []),
    ].some((entry) => entry.configuration.environment !== "TEST")
  )
    throw new TypeError("Invalid TEST payment environment");
  const directory = options.providerDirectory;
  return compose(
    {
      ...options,
      ...(directory === undefined
        ? {}
        : {
            providerDirectory: {
              getRegistrations() {
                const entries = directory.getRegistrations();
                if (
                  entries.some(
                    (entry) => entry.configuration.environment !== "TEST",
                  )
                )
                  throw new TypeError("Invalid TEST payment environment");
                return entries;
              },
            },
          }),
    },
    factories,
  );
}
export function createPaymentRuntimeComposition(
  options: Common & {
    keyManagementConfig: KmsKeyManagementAdapterConfig;
    healthPolicies: readonly PaymentHealthPolicy[];
  },
  factories: Factories = {},
): PaymentRuntimeComposition {
  healthPolicies(
    options.healthPolicies,
    [
      ...options.providers,
      ...(options.providerDirectory?.getRegistrations() ?? []),
    ],
    options.readHealthPolicies !== undefined,
  );
  return compose(
    {
      ...options,
      keyManagement: createKmsKeyManagementAdapter(options.keyManagementConfig),
      activePepperVersion:
        options.keyManagementConfig.activeBlindIndexKeyVersion,
      pepperVersions: Object.keys(
        options.keyManagementConfig.blindIndexKeyIdsByVersion,
      ),
    },
    factories,
  );
}
/** Only statically deployed registrations can activate payment; TEST adapters are never imported here. */
export function createOptionalPaymentRuntimeComposition(
  environment: Readonly<Record<string, string | undefined>>,
  deployedProviders: readonly PaymentRuntimeProviderRegistration[] = [],
): PaymentRuntimeComposition | undefined {
  const configText = environment["FAN_SUPPORT_PAYMENT_RUNTIME_CONFIG_JSON"],
    bindingsText = environment["FAN_SUPPORT_PAYMENT_PROVIDER_BINDINGS_JSON"],
    healthText = environment["FAN_SUPPORT_PAYMENT_HEALTH_POLICIES_JSON"];
  if (
    configText === undefined &&
    bindingsText === undefined &&
    healthText === undefined
  )
    return undefined;
  let configuration: PaymentRuntimeConfiguration;
  let providers: ReturnType<typeof registrations>;
  let policies: PaymentHealthPolicy[];
  try {
    configuration = paymentRuntimeConfigurationSchema.parse(
      JSON.parse(configText ?? ""),
    );
    const raw: unknown = JSON.parse(bindingsText ?? "");
    if (!Array.isArray(raw) || raw.length > 100)
      throw new Error("Invalid payment bindings");
    const bindings = raw.map((entry: unknown) =>
      paymentRuntimeProviderBindingSchema.parse(entry),
    );
    if (
      new Set(bindings.map((entry) => entry.providerAccountId.toLowerCase()))
        .size !== bindings.length
    )
      throw new Error("Duplicate payment binding");
    const deployed = registrations(deployedProviders);
    if (deployed.length === 0) return undefined;
    providers = bindings.map((binding) => {
      const entry = deployed.find(
        (candidate) =>
          candidate.configuration.providerAccountId ===
          binding.providerAccountId,
      );
      if (
        !entry ||
        JSON.stringify(entry.configuration) !== JSON.stringify(binding)
      )
        throw new Error("Unregistered payment provider");
      return entry;
    });
    if (providers.length === 0) return undefined;
    const rawPolicies: unknown = JSON.parse(healthText ?? "");
    if (!Array.isArray(rawPolicies))
      throw new TypeError("Invalid payment health policies");
    policies = healthPolicies(
      rawPolicies.map((entry: unknown) =>
        paymentHealthPolicySchema.parse(entry),
      ),
      providers,
    );
  } catch {
    throw new TypeError("Invalid payment runtime configuration");
  }
  const sources = { environment };
  if (
    resolveServerRuntimeConfig(sources).siteOrigin !==
    configuration.publicStorefrontOrigin
  )
    throw new TypeError("Payment storefront origin does not match deployment");
  return createPaymentRuntimeComposition({
    database: {
      connectionString: resolveDatabaseRuntimeConfig(sources).url,
      application_name: "fan-support-api-payment",
    },
    publicMediaBaseUrl:
      resolveObjectStorageRuntimeConfig(sources).publicMediaOrigin,
    keyManagementConfig: resolveCartRuntimeConfig(environment),
    configuration,
    providers,
    healthPolicies: policies,
  });
}
