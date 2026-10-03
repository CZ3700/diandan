import type {
  DeployedPaymentAdapter,
  PaymentAccountConnection,
} from "@fan-support/contracts";

import type { PaymentRuntimeProviderRegistration } from "./runtime-provider.js";

/** Deployed, synchronous construction only: factories must not perform business I/O. */
export type PaymentConnectorFactory = Readonly<{
  descriptor: DeployedPaymentAdapter;
  create(
    connection: PaymentAccountConnection,
  ): PaymentRuntimeProviderRegistration;
}>;
