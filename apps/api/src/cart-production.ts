import {
  resolveDatabaseRuntimeConfig,
  resolveObjectStorageRuntimeConfig,
  resolveServerRuntimeConfig,
} from "@fan-support/config/server";
import { createCartRuntimeComposition } from "./cart-composition.js";
import { resolveCartRuntimeConfig } from "./cart-runtime-config.js";

/** Absence is explicit unavailability; partial configuration is a startup error. */
export function createOptionalCartRuntimeComposition(
  environment: Readonly<Record<string, string | undefined>>,
) {
  const keys = [
    "FAN_SUPPORT_CART_KMS_REGION",
    "FAN_SUPPORT_CART_ENCRYPTION_KEY_VERSION",
    "FAN_SUPPORT_CART_ENCRYPTION_KEY_IDS_JSON",
    "FAN_SUPPORT_CART_BLIND_INDEX_KEY_VERSION",
    "FAN_SUPPORT_CART_BLIND_INDEX_KEY_IDS_JSON",
  ];
  if (keys.every((key) => environment[key] === undefined)) return undefined;
  const keyManagementConfig = resolveCartRuntimeConfig(environment);
  const sources = { environment };
  const database = resolveDatabaseRuntimeConfig(sources);
  const runtime = resolveServerRuntimeConfig(sources);
  const storage = resolveObjectStorageRuntimeConfig(sources);
  return createCartRuntimeComposition({
    database: {
      connectionString: database.url,
      application_name: "fan-support-api-cart",
    },
    allowedOrigin: runtime.siteOrigin,
    publicMediaBaseUrl: storage.publicMediaOrigin,
    keyManagementConfig,
  });
}
