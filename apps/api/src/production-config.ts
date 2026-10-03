import {
  resolveDatabaseRuntimeConfig,
  resolveObjectStorageRuntimeConfig,
  resolveServerRuntimeConfig,
  type ObjectStorageRuntimeConfig,
} from "@fan-support/config/server";
import type { OrderAccessConfiguration } from "@fan-support/contracts";
import type { KmsKeyManagementAdapterConfig } from "@fan-support/key-management-kms";

import {
  resolveAdminApiRuntimeConfig,
  type AdminApiRuntimeConfig,
} from "./admin-runtime-config.js";
import { resolveCartRuntimeConfig } from "./cart-runtime-config.js";
import { resolveOrderAccessRuntimeConfig } from "./order-access-runtime-config.js";
import { resolveTrustedProxyCidrs } from "./trusted-proxy-config.js";
import {
  resolvePaymentDeploymentConfig,
  type PaymentDeploymentConfig,
} from "./payment-deployment-config.js";

export type ApiProductionConfig = Readonly<{
  siteOrigin: string;
  databaseUrl: string;
  storage: ObjectStorageRuntimeConfig;
  /** Shared by carts, checkout, order access, payment, webhook payload encryption and order operations. */
  keyManagement: KmsKeyManagementAdapterConfig | undefined;
  orderAccess: OrderAccessConfiguration | undefined;
  payment: PaymentDeploymentConfig;
  admin: AdminApiRuntimeConfig | undefined;
}>;

const KEY_MANAGEMENT_KEYS = [
  "FAN_SUPPORT_CART_KMS_REGION",
  "FAN_SUPPORT_CART_ENCRYPTION_KEY_VERSION",
  "FAN_SUPPORT_CART_ENCRYPTION_KEY_IDS_JSON",
  "FAN_SUPPORT_CART_BLIND_INDEX_KEY_VERSION",
  "FAN_SUPPORT_CART_BLIND_INDEX_KEY_IDS_JSON",
] as const;

/** Reads every production setting once, before any pool, client or timer exists. */
export function resolveApiProductionConfig(
  environment: Readonly<Record<string, string | undefined>>,
): ApiProductionConfig {
  const sources = { environment };
  const server = resolveServerRuntimeConfig(sources);
  const database = resolveDatabaseRuntimeConfig(sources);
  const storage = resolveObjectStorageRuntimeConfig(sources);
  // Absence is explicit unavailability; any partial group is a startup error.
  const keyManagement = KEY_MANAGEMENT_KEYS.every(
    (key) => environment[key] === undefined,
  )
    ? undefined
    : resolveCartRuntimeConfig(environment);
  const orderAccess = resolveOrderAccessRuntimeConfig(
    environment,
    server.siteOrigin,
  );
  const payment = resolvePaymentDeploymentConfig(
    environment,
    server.siteOrigin,
  );
  const admin = resolveAdminApiRuntimeConfig(environment);
  const trustedProxies = resolveTrustedProxyCidrs(environment);
  if (keyManagement === undefined) {
    if (admin !== undefined)
      throw new TypeError("Administration requires key management");
    if (orderAccess !== undefined)
      throw new TypeError("Order access requires key management");
    if (payment.runtime !== undefined)
      throw new TypeError("Payment requires key management");
  }
  // Deployed traffic always arrives through the BFF and edge proxies; untrusted, every fan would share one bucket.
  if (
    orderAccess !== undefined &&
    trustedProxies === undefined &&
    (server.deploymentEnvironment === "staging" ||
      server.deploymentEnvironment === "production")
  )
    throw new TypeError("Order access requires trusted proxy addresses");
  return Object.freeze({
    siteOrigin: server.siteOrigin,
    databaseUrl: database.url,
    storage,
    keyManagement,
    orderAccess,
    payment,
    admin,
  });
}
