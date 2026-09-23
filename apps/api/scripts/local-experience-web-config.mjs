import { resolveStorefrontConfig } from "@fan-support/config/server";

/** Supply a labelled TEST identity without borrowing a formal brand. */
export function localStorefrontIdentity(environment) {
  const values = {
    FAN_SUPPORT_STOREFRONT_NAME:
      environment.FAN_SUPPORT_LOCAL_STOREFRONT_NAME ?? "LOCAL TEST STUDIO",
  };
  resolveStorefrontConfig({ environment: values });
  return values;
}
