import {
  cartRuntimeRequestContextSchema,
  paymentRuntimeCommandSchema,
  paymentRuntimeConfigurationSchema,
  paymentRuntimeResponseSchema,
  paymentRuntimeCurrentCheckoutSchema,
  paymentRuntimeRecoveryRunResponseSchema,
  type PaymentRuntimeResponse,
  type PaymentRuntimeConfiguration,
  type PaymentRuntimeCommand,
} from "@fan-support/contracts";
import { projectCheckoutSession } from "@fan-support/domain";
import type { KeyManagementPort } from "@fan-support/key-management-port";
import type {
  PaymentRuntimeProviderDirectory,
  PaymentRuntimeProviderRegistration,
} from "@fan-support/payment-port";
import type { PaymentRuntimeTransactionManager } from "@fan-support/persistence-port";
import { readAuthorizedPayment } from "./payment-runtime-action.js";
import { listPaymentCapabilities } from "./payment-runtime-capabilities.js";
import { createRuntimePayment } from "./payment-runtime-create.js";
import { paymentProviderRegistrations } from "./payment-runtime-provider.js";
import {
  recoverNextRuntimePayment,
  recoverRuntimePayment,
} from "./payment-runtime-recovery.js";
import {
  paymentFailure,
  paymentTransactions,
  withPaymentFailure,
  type PaymentRuntime,
} from "./payment-runtime-context.js";

export function createPaymentRuntimeUseCases({
  transactions,
  keyManagement,
  providers,
  providerDirectory,
  configuration,
}: {
  transactions: PaymentRuntimeTransactionManager;
  keyManagement: KeyManagementPort;
  providers: readonly PaymentRuntimeProviderRegistration[];
  providerDirectory?: PaymentRuntimeProviderDirectory;
  configuration: PaymentRuntimeConfiguration;
}) {
  const registered = paymentProviderRegistrations(providers, providerDirectory);
  const runtime: PaymentRuntime = {
    run: paymentTransactions(transactions),
    keys: keyManagement,
    get providers() {
      return registered();
    },
    configuration: paymentRuntimeConfigurationSchema.parse(configuration),
  };
  const execute = async (
    operation: PaymentRuntimeCommand["operation"],
    input: unknown,
    trusted: unknown,
  ): Promise<PaymentRuntimeResponse> => {
    const command = paymentRuntimeCommandSchema.safeParse(input),
      context = cartRuntimeRequestContextSchema.safeParse(trusted);
    if (!command.success || command.data.operation !== operation)
      return paymentFailure("INVALID_COMMAND");
    if (!context.success) return paymentFailure("INVALID_ACCESS");
    if (
      (operation === "CREATE_PAYMENT_ATTEMPT" ||
        operation === "RECOVER_PAYMENT_ATTEMPT") &&
      context.data.idempotencyKey === undefined
    )
      return paymentFailure("INVALID_COMMAND");
    return paymentRuntimeResponseSchema.parse(
      await withPaymentFailure(async () => {
        const value = command.data;
        switch (value.operation) {
          case "CREATE_PAYMENT_ATTEMPT":
            return createRuntimePayment(runtime, value, context.data);
          case "RECOVER_PAYMENT_ATTEMPT":
            return recoverRuntimePayment(runtime, value, context.data);
          case "READ_PAYMENT_CAPABILITIES":
            return {
              schemaVersion: 1,
              outcome: "SUCCESS",
              action: "CAPABILITIES",
              capabilities: await listPaymentCapabilities(
                runtime,
                value,
                context.data,
              ),
            };
          case "READ_PAYMENT_ATTEMPT":
            return {
              schemaVersion: 1,
              outcome: "SUCCESS",
              action: "READ",
              attempt: await readAuthorizedPayment(
                runtime,
                context.data,
                value.checkoutSessionId,
                value.attemptId,
              ),
            };
          case "READ_CURRENT_CHECKOUT": {
            const raw = await runtime.run(({ paymentRuntime }) =>
              paymentRuntime.loadCurrentCheckout({
                schemaVersion: 1,
                accesses: context.data.accesses,
              }),
            );
            if (raw === null)
              return { schemaVersion: 1, outcome: "SUCCESS", action: "EMPTY" };
            const record = paymentRuntimeCurrentCheckoutSchema.parse(raw);
            const attempt =
              record.attempt === null
                ? null
                : await readAuthorizedPayment(
                    runtime,
                    context.data,
                    record.checkout.receipt.checkoutSessionId,
                    record.attempt.id,
                  );
            return {
              schemaVersion: 1,
              outcome: "SUCCESS",
              action: "CURRENT",
              checkout: projectCheckoutSession(record.checkout),
              attempt,
            };
          }
        }
      }),
    );
  };
  return Object.freeze({
    capabilities: (input: unknown, context: unknown) =>
      execute("READ_PAYMENT_CAPABILITIES", input, context),
    create: (input: unknown, context: unknown) =>
      execute("CREATE_PAYMENT_ATTEMPT", input, context),
    read: (input: unknown, context: unknown) =>
      execute("READ_PAYMENT_ATTEMPT", input, context),
    recover: (input: unknown, context: unknown) =>
      execute("RECOVER_PAYMENT_ATTEMPT", input, context),
    current: (input: unknown, context: unknown) =>
      execute("READ_CURRENT_CHECKOUT", input, context),
    recoverNext: async () =>
      paymentRuntimeRecoveryRunResponseSchema.parse(
        await withPaymentFailure(() => recoverNextRuntimePayment(runtime)),
      ),
  });
}
