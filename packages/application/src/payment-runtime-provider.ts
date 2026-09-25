import {
  paymentPortResponseMatchesCommand,
  paymentPortResponseSchema,
  paymentRuntimeProviderBindingSchema,
  type PaymentPortCommand,
  type PaymentRuntimeProviderBinding,
  type PaymentAction,
  type PaymentDeviceCapability,
  type PaymentRuntimeProviderLocale,
} from "@fan-support/contracts";
import { canonicalPublicationValue } from "@fan-support/content";
import type {
  PaymentProvider,
  PaymentRuntimeProviderDirectory,
  PaymentRuntimeProviderRegistration,
} from "@fan-support/payment-port";

function freezeBinding<Value>(value: Value): Value {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeBinding(child);
    Object.freeze(value);
  }
  return value;
}
function copyRegistration(
  entry: PaymentRuntimeProviderRegistration,
): PaymentRuntimeProviderRegistration {
  const configuration = freezeBinding(
    paymentRuntimeProviderBindingSchema.parse(entry.configuration),
  );
  const provider = entry.provider;
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
      "Payment registration must implement the complete provider port",
    );
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
const registrationKey = ({
  configuration,
}: PaymentRuntimeProviderRegistration) =>
  `${configuration.environment}/${configuration.providerAccountId.toLowerCase()}`;

/** Revalidate dynamic projections without allowing them to rewrite an earlier account binding. */
export function paymentProviderRegistrations(
  providers: readonly PaymentRuntimeProviderRegistration[],
  directory?: PaymentRuntimeProviderDirectory,
): () => readonly PaymentRuntimeProviderRegistration[] {
  const fixed = providers.map(copyRegistration);
  const readDirectory = directory?.getRegistrations.bind(directory);
  let known = new Map<string, PaymentRuntimeProviderRegistration>();
  const read = () => {
    const entries = [
      ...fixed,
      ...(readDirectory?.() ?? []).map(copyRegistration),
    ];
    const next = new Map(
      entries.map((entry) => [registrationKey(entry), entry]),
    );
    if (next.size !== entries.length)
      throw new TypeError("Duplicate payment provider registration");
    for (const [key, previous] of known) {
      const current = next.get(key);
      if (
        current === undefined ||
        canonicalPublicationValue(current.configuration) !==
          canonicalPublicationValue(previous.configuration)
      )
        throw new TypeError(
          "Historical payment provider bindings cannot be changed or removed",
        );
      next.set(key, previous);
    }
    const result = Object.freeze([...next.values()]);
    known = next;
    return result;
  };
  read();
  return read;
}

export function findPaymentProvider(
  providers: readonly PaymentRuntimeProviderRegistration[],
  identity: {
    providerAccountId: string;
    environment: string;
    adapterKey: string;
  },
) {
  return providers.find(
    ({ configuration }) =>
      configuration.providerAccountId.toLowerCase() ===
        identity.providerAccountId.toLowerCase() &&
      configuration.environment === identity.environment &&
      configuration.providerCode === identity.adapterKey,
  );
}

export function allowedPaymentAction(
  action: PaymentAction,
  binding: PaymentRuntimeProviderBinding,
  supported: readonly PaymentDeviceCapability[],
): boolean {
  if (action.type === "WAIT") return true;
  if (!supported.includes(action.type)) return false;
  if (action.type === "REDIRECT" || action.type === "PROVIDER_HOSTED_IFRAME")
    return binding.allowedActionOrigins.includes(
      new URL(action.url)
        .origin as (typeof binding.allowedActionOrigins)[number],
    );
  return true;
}

/** Untrusted create responses never have financial-finalization authority. */
export function readPaymentCreateResult(
  command: PaymentPortCommand,
  input: unknown,
  binding: PaymentRuntimeProviderBinding,
  supported: readonly PaymentDeviceCapability[],
  pinnedLocale?: PaymentRuntimeProviderLocale,
) {
  const parsed = paymentPortResponseSchema.safeParse(input);
  if (
    command.operation !== "CREATE_PAYMENT" ||
    !parsed.success ||
    parsed.data.operation !== "CREATE_PAYMENT" ||
    parsed.data.outcome !== "SUCCESS" ||
    !paymentPortResponseMatchesCommand(command, parsed.data)
  )
    return null;
  const result = parsed.data.value;
  const mapping =
    pinnedLocale ?? binding.localeMapping[command.requestedLocale];
  if (
    result.providerLocale !== mapping.providerLocale ||
    result.fallbackUsed !== mapping.fallbackUsed ||
    (result.action !== undefined &&
      !allowedPaymentAction(result.action, binding, supported))
  )
    return null;
  return result;
}

/** A lookup may restore a hosted action only after authenticated reconcile authorized this exact reference. */
export function readPaymentRecoveryAction(
  command: PaymentPortCommand,
  input: unknown,
  binding: PaymentRuntimeProviderBinding,
  supported: readonly PaymentDeviceCapability[],
  pinnedLocale: PaymentRuntimeProviderLocale,
) {
  const parsed = paymentPortResponseSchema.safeParse(input);
  if (
    command.operation !== "GET_PAYMENT" ||
    !parsed.success ||
    parsed.data.operation !== "GET_PAYMENT" ||
    parsed.data.outcome !== "SUCCESS" ||
    !paymentPortResponseMatchesCommand(command, parsed.data)
  )
    return null;
  const result = parsed.data.value;
  if (
    result.status !== "REQUIRES_ACTION" ||
    result.providerLocale !== pinnedLocale.providerLocale ||
    result.fallbackUsed !== pinnedLocale.fallbackUsed ||
    result.action === undefined ||
    result.action.type === "WAIT" ||
    !allowedPaymentAction(result.action, binding, supported)
  )
    return null;
  return result.action;
}

/** An empty, well-formed capability list is an ordinary unavailable result. */
export function readPaymentCapabilities(
  command: PaymentPortCommand,
  input: unknown,
) {
  const parsed = paymentPortResponseSchema.safeParse(input);
  if (
    command.operation !== "GET_CAPABILITIES" ||
    !parsed.success ||
    parsed.data.operation !== "GET_CAPABILITIES" ||
    parsed.data.outcome !== "SUCCESS"
  )
    return null;
  if (parsed.data.value.capabilities.length === 0) return [];
  if (!paymentPortResponseMatchesCommand(command, parsed.data)) return null;
  return parsed.data.value.capabilities;
}
