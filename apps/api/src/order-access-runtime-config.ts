import {
  orderAccessConfigurationSchema,
  type OrderAccessConfiguration,
} from "@fan-support/contracts";

/** Only an explicit, complete server configuration activates access. No credentials or defaults are generated. */
export function resolveOrderAccessRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>>,
  siteOrigin: string,
): OrderAccessConfiguration | undefined {
  const text = environment["FAN_SUPPORT_ORDER_ACCESS_CONFIG_JSON"];
  if (text === undefined) return undefined;
  let configuration: OrderAccessConfiguration;
  try {
    if (text.length > 16_384)
      throw new Error("Invalid order access configuration");
    configuration = orderAccessConfigurationSchema.parse(JSON.parse(text));
  } catch {
    throw new TypeError("Invalid order access runtime configuration");
  }
  if (siteOrigin !== configuration.publicStorefrontOrigin)
    throw new TypeError("Order access origin does not match deployment");
  return configuration;
}
