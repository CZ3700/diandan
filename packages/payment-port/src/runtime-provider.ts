import type { PaymentRuntimeProviderBinding } from "@fan-support/contracts";
import type { PaymentProvider } from "./index.js";

/** Composition-time dependency registration. All runtime business I/O still uses PaymentProvider contracts. */
export type PaymentRuntimeProviderRegistration = Readonly<{
  configuration: PaymentRuntimeProviderBinding;
  provider: PaymentProvider;
}>;
