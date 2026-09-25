import {
  deployedPaymentAdapterSchema,
  paymentConnectorSnapshotSchema,
  paymentRuntimeProviderBindingSchema,
  type DeployedPaymentAdapter,
  type PaymentAccountConnection,
} from "@fan-support/contracts";
import type {
  PaymentProvider,
  PaymentRuntimeProviderDirectory,
  PaymentRuntimeProviderRegistration,
} from "@fan-support/payment-port";

/** Deployed, synchronous construction only: factories must not perform business I/O. */
export type PaymentConnectorFactory = Readonly<{
  descriptor: DeployedPaymentAdapter;
  create(
    connection: PaymentAccountConnection,
  ): PaymentRuntimeProviderRegistration;
}>;

function freeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const accountKey = (connection: PaymentAccountConnection) =>
  connection.binding.providerAccountId.toLowerCase();
const factoryKey = (key: string, version: string, protocol: string) =>
  `${key}/${version}/${protocol}`;

function registration(
  input: PaymentRuntimeProviderRegistration,
  connection: PaymentAccountConnection,
): PaymentRuntimeProviderRegistration {
  const configuration = freeze(
    paymentRuntimeProviderBindingSchema.parse(input.configuration),
  );
  if (canonical(configuration) !== canonical(connection.binding))
    throw new TypeError("Payment factory returned a different account binding");
  const provider = input.provider;
  const methods = [
    "getCapabilities",
    "createPayment",
    "getPayment",
    "cancelPayment",
    "refundPayment",
    "reconcilePayment",
    "reconcileRefund",
  ] as const;
  if (methods.some((method) => typeof provider?.[method] !== "function"))
    throw new TypeError(
      "Payment factory must implement the complete provider port",
    );
  // Capture methods while preserving the adapter's private, mutable transport state.
  const copied: PaymentProvider = {
    getCapabilities: provider.getCapabilities.bind(provider),
    createPayment: provider.createPayment.bind(provider),
    getPayment: provider.getPayment.bind(provider),
    cancelPayment: provider.cancelPayment.bind(provider),
    refundPayment: provider.refundPayment.bind(provider),
    reconcilePayment: provider.reconcilePayment.bind(provider),
    reconcileRefund: provider.reconcileRefund.bind(provider),
  };
  return Object.freeze({ configuration, provider: Object.freeze(copied) });
}

/** Accepts a trusted published projection; it neither publishes configuration nor authorizes routing. */
export function createPaymentConnectorRegistry(
  factories: readonly PaymentConnectorFactory[],
) {
  const deployed = new Map<string, PaymentConnectorFactory>();
  for (const factory of factories) {
    const descriptor = freeze(
      deployedPaymentAdapterSchema.parse(factory.descriptor),
    );
    const key = factoryKey(
      descriptor.adapterKey,
      descriptor.adapterVersion,
      descriptor.protocol,
    );
    if (deployed.has(key) || typeof factory.create !== "function")
      throw new TypeError("Invalid or duplicate deployed payment factory");
    deployed.set(
      key,
      Object.freeze({ descriptor, create: factory.create.bind(factory) }),
    );
  }
  let revision = 0;
  let fingerprint: string | undefined;
  let connections = new Map<string, string>();
  let registrations = new Map<string, PaymentRuntimeProviderRegistration>();
  let published: readonly PaymentRuntimeProviderRegistration[] = Object.freeze(
    [],
  );
  const directory: PaymentRuntimeProviderDirectory = Object.freeze({
    getRegistrations: () => published,
  });
  return Object.freeze({
    directory,
    get revision() {
      return revision;
    },
    applyPublishedSnapshot(input: unknown): void {
      const snapshot = freeze(paymentConnectorSnapshotSchema.parse(input));
      const ordered = [...snapshot.connections].sort((a, b) =>
        accountKey(a).localeCompare(accountKey(b), "en"),
      );
      const nextFingerprint = canonical(ordered);
      if (
        snapshot.revision < revision ||
        (snapshot.revision === revision && nextFingerprint !== fingerprint)
      )
        throw new TypeError(
          "Payment connector revision conflicts with the published snapshot",
        );
      if (snapshot.revision === revision) return;
      const nextConnections = new Map(
        ordered.map((connection) => [
          accountKey(connection),
          canonical(connection),
        ]),
      );
      for (const [key, previous] of connections)
        if (nextConnections.get(key) !== previous)
          throw new TypeError(
            "Historical payment account connections cannot be changed or removed",
          );
      // Validate the entire projection before any factory is called.
      const additions = ordered
        .filter((connection) => !connections.has(accountKey(connection)))
        .map((connection) => {
          const factory = deployed.get(
            factoryKey(
              connection.binding.providerCode,
              connection.adapterVersion,
              connection.protocol,
            ),
          );
          if (
            factory === undefined ||
            connection.instruments.some(
              (instrument) =>
                !factory.descriptor.supportedInstrumentKinds.includes(
                  instrument.kind,
                ),
            )
          )
            throw new TypeError(
              "Payment connection requires an unsupported deployed adapter",
            );
          if (
            factory.descriptor.idempotency.retention !== "DURABLE" ||
            !factory.descriptor.idempotency.referenceLookup
          )
            throw new TypeError(
              "Payment recovery requires durable idempotency and reference lookup",
            );
          const requiredOperations = [
            "GET_CAPABILITIES",
            "CREATE_PAYMENT",
            "GET_PAYMENT",
            "RECONCILE_PAYMENT",
          ] as const;
          if (
            requiredOperations.some(
              (operation) =>
                !factory.descriptor.supportedOperations.includes(operation),
            )
          )
            throw new TypeError(
              "Payment connection does not support the creation and recovery workflow",
            );
          return { connection, factory };
        });
      const nextRegistrations = new Map(registrations);
      for (const { connection, factory } of additions)
        nextRegistrations.set(
          accountKey(connection),
          registration(factory.create(connection), connection),
        );
      // Nothing becomes visible until every new adapter has been constructed and validated.
      const nextPublished = Object.freeze(
        ordered.map((connection) =>
          nextRegistrations.get(accountKey(connection))!,
        ),
      );
      connections = nextConnections;
      registrations = nextRegistrations;
      published = nextPublished;
      fingerprint = nextFingerprint;
      revision = snapshot.revision;
    },
  });
}
