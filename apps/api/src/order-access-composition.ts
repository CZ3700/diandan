import { createOrderAccessUseCases } from "@fan-support/application";
import {
  orderAccessConfigurationSchema,
  paymentRuntimeOriginSchema,
  type OrderAccessConfiguration,
} from "@fan-support/contracts";
import type { KeyManagementPort } from "@fan-support/key-management-port";
import type { DeliveryProofReadPort } from "@fan-support/media-port";
import type { PostgresPersistence } from "@fan-support/persistence-postgres";
import type { ApiLifecycleResource } from "./bootstrap.js";
import { createCartSessionCredentials } from "./cart-session-credentials.js";
import { createOrderAccessCredentials } from "./order-access-credentials.js";
import type { OrderAccessRouteDependencies } from "./order-access-route.js";

type Persistence = Pick<
  PostgresPersistence,
  "orderAccessTransactionManager" | "close"
>;
export type OrderAccessCompositionOptions = Readonly<{
  /** Called once after validation; stopping the runtime closes what it returned. */
  openPersistence(): Persistence;
  publicMediaBaseUrl: string;
  configuration: OrderAccessConfiguration;
  keyManagement: KeyManagementPort;
  activePepperVersion: string;
  pepperVersions: readonly string[];
  /** Private delivery photos; without storage the photo route answers 503. */
  proofReader?: DeliveryProofReadPort | undefined;
}>;
export type OrderAccessComposition = Readonly<{
  orderAccessRoute: OrderAccessRouteDependencies;
  orderAccessRuntime: ApiLifecycleResource;
}>;

/** Order access shares the deployment's key port and borrows an injected pool. */
export function createOrderAccessComposition(
  options: OrderAccessCompositionOptions,
): OrderAccessComposition {
  const configuration = orderAccessConfigurationSchema.parse(
    options.configuration,
  );
  paymentRuntimeOriginSchema.parse(options.publicMediaBaseUrl);
  const credentials = createOrderAccessCredentials(options);
  const cartCredentials = createCartSessionCredentials(options);
  const persistence = options.openPersistence();
  let closed: Promise<void> | undefined;
  const stop = () =>
    (closed ??= Promise.resolve().then(() => persistence.close()));
  try {
    const useCases = createOrderAccessUseCases({
      transactions: persistence.orderAccessTransactionManager,
      proofReader: options.proofReader,
    });
    return Object.freeze({
      orderAccessRoute: {
        configuration,
        credentials,
        cartCredentials,
        useCases,
        readProof: useCases.readProof,
      },
      orderAccessRuntime: { start: async () => undefined, stop },
    });
  } catch {
    void stop().catch(() => undefined);
    throw new TypeError("Order access runtime construction failed");
  }
}
