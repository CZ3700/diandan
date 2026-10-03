import "server-only";

import {
  resolveServerRuntimeConfig,
  resolveStorefrontConfig,
  type ServerRuntimeConfig,
  resolveStorefrontPreviewConfig,
} from "@fan-support/config/server";

export function loadStorefrontRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ServerRuntimeConfig {
  return resolveServerRuntimeConfig({ environment });
}

export function loadStorefrontPresentationConfig() {
  return resolveStorefrontConfig({ environment: process.env });
}

export function loadStorefrontPreviewConfig() {
  return resolveStorefrontPreviewConfig({ environment: process.env });
}
