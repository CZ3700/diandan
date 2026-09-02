import "server-only";

import {
  resolveServerRuntimeConfig,
  type ServerRuntimeConfig,
} from "@fan-support/config/server";

export function loadStorefrontRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ServerRuntimeConfig {
  return resolveServerRuntimeConfig({ environment });
}
