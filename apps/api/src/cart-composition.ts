import {
  createCartRuntimeUseCases,
  createCartEditUseCases,
} from "@fan-support/application";
import type {
  KeyManagementPort,
  SupportIntentKeyPort,
} from "@fan-support/key-management-port";
import type { PostgresPersistence } from "@fan-support/persistence-postgres";
import type { ApiLifecycleResource } from "./bootstrap.js";
import type { CartRouteDependencies } from "./cart-route.js";
import type { CartEditRouteDependencies } from "./cart-edit-route.js";
import { createCartSessionCredentials } from "./cart-session-credentials.js";

type CartPersistence = Pick<
  PostgresPersistence,
  "cartRuntimeTransactionManager" | "cartEditTransactionManager" | "close"
>;
export type CartRuntimeCompositionOptions = Readonly<{
  /** Called once after validation; stopping the runtime closes what it returned. */
  openPersistence(): CartPersistence;
  allowedOrigin: string;
  publicMediaBaseUrl: string;
  keyManagement: KeyManagementPort & SupportIntentKeyPort;
  activePepperVersion: string;
  pepperVersions: readonly string[];
  now?: () => Date;
  cartTtlMs?: number;
}>;
export type CartRuntimeComposition = Readonly<{
  cartRoute: CartRouteDependencies;
  cartEditRoute: CartEditRouteDependencies;
  cartRuntime: ApiLifecycleResource;
}>;
function validOrigin(value: string, httpsOnly = false): void {
  const origin = new URL(value);
  if (
    origin.origin !== value ||
    !(httpsOnly ? ["https:"] : ["https:", "http:"]).includes(origin.protocol)
  )
    throw new TypeError("Invalid cart composition origin");
}
/** Wires cart use cases onto an injected key port and pool; the pool is released on stop. */
export function createCartRuntimeComposition(
  options: CartRuntimeCompositionOptions,
): CartRuntimeComposition {
  validOrigin(options.allowedOrigin);
  validOrigin(options.publicMediaBaseUrl, true);
  const credentials = createCartSessionCredentials(options);
  const persistence = options.openPersistence();
  let close: Promise<void> | undefined;
  const stop = () =>
    (close ??= Promise.resolve().then(() => persistence.close()));
  try {
    const useCases = createCartRuntimeUseCases({
      transactions: persistence.cartRuntimeTransactionManager,
      keyManagement: options.keyManagement,
      ...(options.now ? { now: options.now } : {}),
      ...(options.cartTtlMs !== undefined
        ? { cartTtlMs: options.cartTtlMs }
        : {}),
    });
    const editUseCases = createCartEditUseCases({
      transactions: persistence.cartEditTransactionManager,
      keyManagement: options.keyManagement,
    });
    return Object.freeze({
      cartRoute: {
        allowedOrigin: options.allowedOrigin,
        credentials,
        useCases,
      },
      cartEditRoute: {
        allowedOrigin: options.allowedOrigin,
        credentials,
        useCases: editUseCases,
      },
      cartRuntime: { start: async () => undefined, stop },
    });
  } catch {
    void stop().catch(() => undefined);
    throw new TypeError("Cart runtime construction failed");
  }
}
