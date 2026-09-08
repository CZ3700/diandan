import {
  paymentPortResponseMatchesCommand,
  paymentPortResponseSchema,
  type PaymentPortCommand,
  type PaymentRuntimeProviderBinding,
  type PaymentAction,
  type PaymentDeviceCapability,
  type PaymentRuntimeProviderLocale,
} from "@fan-support/contracts";
import type { PaymentRuntimeProviderRegistration } from "@fan-support/payment-port";

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
