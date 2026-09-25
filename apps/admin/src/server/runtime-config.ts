import "server-only";

import {
  resolveServerRuntimeConfig,
  resolveAdminRuntimeConfig,
  type ServerRuntimeConfig,
} from "@fan-support/config/server";

export function loadAdminRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ServerRuntimeConfig {
  return resolveServerRuntimeConfig({ environment });
}

export function loadAdminWorkspaceConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  return resolveAdminRuntimeConfig({ environment });
}
