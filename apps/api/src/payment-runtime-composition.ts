import { createPaymentRuntimeUseCases } from "@fan-support/application";
import {
  paymentRuntimeConfigurationSchema,
  paymentRuntimeProviderBindingSchema,
  paymentRuntimeOriginSchema,
  paymentHealthPolicySchema,
  type PaymentHealthPolicy,
  type PaymentRuntimeConfiguration,
} from "@fan-support/contracts";
import type { KeyManagementPort } from "@fan-support/key-management-port";
import type {
  PaymentRuntimeProviderRegistration,
  PaymentRuntimeProviderDirectory,
} from "@fan-support/payment-port";
import type { PostgresPersistence } from "@fan-support/persistence-postgres";
import { createCartSessionCredentials } from "./cart-session-credentials.js";
import { createPaymentRecoveryLifecycle } from "./payment-runtime-lifecycle.js";
import type { ApiLifecycleResource } from "./bootstrap.js";
import type { PaymentRuntimeRouteDependencies } from "./payment-runtime-route.js";
type Persistence = Pick<
  PostgresPersistence,
  "paymentRuntimeTransactionManager" | "close"
> & {
  paymentHealthTransactionManager?: PostgresPersistence["paymentHealthTransactionManager"];
};
export type PaymentRuntimeComposeOptions = {
  /** Called once after validation; stopping the runtime closes what it returned. */
  openPersistence(): Persistence;
  publicMediaBaseUrl: string;
  configuration: PaymentRuntimeConfiguration;
  providers: readonly PaymentRuntimeProviderRegistration[];
  providerDirectory?: PaymentRuntimeProviderDirectory;
  healthPolicies?: readonly PaymentHealthPolicy[];
  readHealthPolicies?: () => readonly PaymentHealthPolicy[];
  keyManagement: KeyManagementPort;
  activePepperVersion: string;
  pepperVersions: readonly string[];
  /** Alert sink for UNKNOWN attempts that still cannot be reconciled (audit PAY-01). */
  onRecoveryUnresolved?: () => void;
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
/** Wiring shared by the production and TEST roots; each root decides whether health policies are mandatory. */
export function composePaymentRuntime(
  options: PaymentRuntimeComposeOptions,
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
  const persistence = options.openPersistence();
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
      ...(options.onRecoveryUnresolved === undefined
        ? {}
        : { onRecoveryUnresolved: options.onRecoveryUnresolved }),
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
export type PaymentRuntimeCompositionOptions = PaymentRuntimeComposeOptions & {
  healthPolicies: readonly PaymentHealthPolicy[];
};
/** Only statically deployed adapters reach this composition; health policies are always explicit. */
export function createPaymentRuntimeComposition(
  options: PaymentRuntimeCompositionOptions,
): PaymentRuntimeComposition {
  healthPolicies(
    options.healthPolicies,
    [
      ...options.providers,
      ...(options.providerDirectory?.getRegistrations() ?? []),
    ],
    options.readHealthPolicies !== undefined,
  );
  return composePaymentRuntime(options);
}
