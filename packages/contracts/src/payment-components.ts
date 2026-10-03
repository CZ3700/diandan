import { z } from "zod";

import { currencySchema } from "./commerce.js";
import { providerClientTokenSchema } from "./identifiers.js";
import { publicHttpsUrlSchema } from "./presentation.js";

/**
 * Provider components are launched by storefront code shipped with the release. A component
 * key names one launcher; its client token is produced by the matching deployed adapter.
 */
export const AIRWALLEX_HPP_COMPONENT_KEY = "airwallex-hpp";

/** Hosted Payment Page locales accepted by Airwallex.js `redirectToCheckout` (2026-09-26). */
export const AIRWALLEX_HPP_LOCALES = Object.freeze([
  "ar",
  "da",
  "de",
  "en",
  "es",
  "fi",
  "fr",
  "he",
  "id",
  "it",
  "ja",
  "ko",
  "ms",
  "nl",
  "pl",
  "pt",
  "ro",
  "ru",
  "si",
  "sv",
  "tr",
  "vi",
  "ur",
  "zh",
  "zh-HK",
] as const);

export const airwallexHppLaunchSchema = z.strictObject({
  v: z.literal(1),
  env: z.enum(["sandbox", "prod"]),
  intentId: z
    .string()
    .max(128)
    .regex(/^int_[A-Za-z0-9-]+(?:_[A-Za-z0-9-]+)*$/u),
  clientSecret: z
    .string()
    .min(16)
    .max(2_048)
    .regex(/^[\x21-\x7e]+$/u),
  currency: currencySchema,
  locale: z.enum(AIRWALLEX_HPP_LOCALES),
  cancelUrl: publicHttpsUrlSchema,
});
export type AirwallexHppLaunch = z.infer<typeof airwallexHppLaunchSchema>;

/** Standard base64: the platform client-token alphabet has no `_`, so base64url cannot be used. */
export function encodeAirwallexHppClientToken(
  launch: AirwallexHppLaunch,
): string {
  const bytes = new TextEncoder().encode(
    JSON.stringify(airwallexHppLaunchSchema.parse(launch)),
  );
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return providerClientTokenSchema.parse(btoa(binary));
}

export function decodeAirwallexHppClientToken(
  token: string,
): AirwallexHppLaunch | undefined {
  if (!providerClientTokenSchema.safeParse(token).success) return undefined;
  try {
    const binary = atob(token);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    );
    const parsed = airwallexHppLaunchSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
