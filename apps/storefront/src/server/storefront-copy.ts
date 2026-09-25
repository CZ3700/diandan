import "server-only";

import type { SupportedLocale } from "@fan-support/contracts";
import { loadStorefrontCopy as loadCopy } from "@fan-support/i18n/storefront";
import { loadStorefrontRuntimeConfig } from "./runtime-config";

export function loadStorefrontCopy(locale: SupportedLocale) {
  const { deploymentEnvironment } = loadStorefrontRuntimeConfig();
  return loadCopy(locale, {
    requireApproved: deploymentEnvironment === "production",
  });
}
