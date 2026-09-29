import { z } from "zod";
import {
  adminAccessSettingsSchema,
  paymentRuntimeOriginSchema,
  type AdminAccessSettings,
} from "@fan-support/contracts";
import type { OidcIdentityProviderOptions } from "@fan-support/identity-oidc";

export type AdminApiRuntimeConfig = Readonly<{
  allowedOrigin: string;
  accessKey: string;
  tokenPepper: string;
  subjectPepper: string;
  /** OIDC sign-in; both present or both absent. Optional once built-in accounts are enabled. */
  settings?: AdminAccessSettings;
  provider?: OidcIdentityProviderOptions;
  /** ADR-021 built-in accounts. */
  localAccounts?: Readonly<{ totpIssuer: string }>;
}>;

// Keys owned only by the API decide presence. The Admin app shares the access key and issuer
// for its own development modes, so those two alone never switch the API surface on.
const API_ONLY_KEYS = [
  "FAN_SUPPORT_ADMIN_ORIGIN",
  "FAN_SUPPORT_ADMIN_TOKEN_PEPPER",
  "FAN_SUPPORT_ADMIN_SUBJECT_PEPPER",
  "FAN_SUPPORT_ADMIN_OIDC_CONFIG_JSON",
  "FAN_SUPPORT_ADMIN_OIDC_CLIENT_SECRET",
  "FAN_SUPPORT_ADMIN_LOCAL_ACCOUNTS",
  "FAN_SUPPORT_ADMIN_TOTP_ISSUER",
] as const;
const DEFAULT_TOTP_ISSUER = "Studio Admin";
// Authenticator apps split the otpauth label on ":"; keep the label plain.
const totpIssuerSchema = z.string().regex(/^[\p{L}\p{N} ._-]{1,64}$/u);
const CALLBACK_PATH = "/api/admin/auth/callback";
const hexSecretSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const clientSecretSchema = z
  .string()
  .min(16)
  .max(512)
  .refine(
    (value) =>
      value.trim() === value &&
      [...value].every((character) => {
        const code = character.charCodeAt(0);
        return code > 0x1f && code !== 0x7f;
      }),
  );
const oidcConfigurationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  clientId: adminAccessSettingsSchema.shape.clientId,
  clientAuthentication: z.enum(["NONE", "CLIENT_SECRET_BASIC"]),
  acceptedAcrValues: z.array(z.string()).max(32),
  requiredAmrValues: z.array(z.string()).max(32),
  policyVersion: adminAccessSettingsSchema.shape.policyVersion,
  loginTtlSeconds: adminAccessSettingsSchema.shape.loginTtlSeconds,
  sessionTtlSeconds: adminAccessSettingsSchema.shape.sessionTtlSeconds,
  maxAuthenticationAgeSeconds:
    adminAccessSettingsSchema.shape.maxAuthenticationAgeSeconds,
});

/** Absent means the administration surface is not deployed; any partial or unsafe value stops startup. */
export function resolveAdminApiRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>>,
): AdminApiRuntimeConfig | undefined {
  if (API_ONLY_KEYS.every((key) => environment[key] === undefined))
    return undefined;
  try {
    const allowedOrigin = paymentRuntimeOriginSchema.parse(
      environment["FAN_SUPPORT_ADMIN_ORIGIN"],
    );
    const accessKey = hexSecretSchema.parse(
      environment["FAN_SUPPORT_ADMIN_ACCESS_KEY"],
    );
    const tokenPepper = hexSecretSchema.parse(
      environment["FAN_SUPPORT_ADMIN_TOKEN_PEPPER"],
    );
    const subjectPepper = hexSecretSchema.parse(
      environment["FAN_SUPPORT_ADMIN_SUBJECT_PEPPER"],
    );
    if (new Set([accessKey, tokenPepper, subjectPepper]).size !== 3)
      throw new Error("Administration secrets must be independent");
    const base = { allowedOrigin, accessKey, tokenPepper, subjectPepper };
    const switchValue = environment["FAN_SUPPORT_ADMIN_LOCAL_ACCOUNTS"];
    const issuerValue = environment["FAN_SUPPORT_ADMIN_TOTP_ISSUER"];
    if (switchValue !== undefined && switchValue !== "ENABLED")
      throw new Error("Unknown built-in account switch");
    if (switchValue === undefined && issuerValue !== undefined)
      throw new Error("Authenticator label without built-in accounts");
    const localAccounts =
      switchValue === "ENABLED"
        ? Object.freeze({
            totpIssuer: totpIssuerSchema.parse(
              issuerValue ?? DEFAULT_TOTP_ISSUER,
            ),
          })
        : undefined;
    const oidcRequested =
      environment["FAN_SUPPORT_ADMIN_OIDC_CONFIG_JSON"] !== undefined ||
      environment["FAN_SUPPORT_ADMIN_OIDC_CLIENT_SECRET"] !== undefined;
    if (localAccounts !== undefined && !oidcRequested)
      return Object.freeze({ ...base, localAccounts });
    const text = environment["FAN_SUPPORT_ADMIN_OIDC_CONFIG_JSON"];
    if (text === undefined || text.length > 16_384)
      throw new Error("Invalid identity configuration");
    const oidc = oidcConfigurationSchema.parse(JSON.parse(text));
    if (oidc.acceptedAcrValues.length + oidc.requiredAmrValues.length === 0)
      throw new Error("Administration requires an MFA assertion");
    const clientSecret = environment["FAN_SUPPORT_ADMIN_OIDC_CLIENT_SECRET"];
    if ((oidc.clientAuthentication === "NONE") !== (clientSecret === undefined))
      throw new Error("Client authentication does not match its secret");
    const settings = adminAccessSettingsSchema.parse({
      schemaVersion: 1,
      issuer: environment["FAN_SUPPORT_ADMIN_OIDC_ISSUER"],
      clientId: oidc.clientId,
      redirectUri: `${allowedOrigin}${CALLBACK_PATH}`,
      policyVersion: oidc.policyVersion,
      loginTtlSeconds: oidc.loginTtlSeconds,
      sessionTtlSeconds: oidc.sessionTtlSeconds,
      maxAuthenticationAgeSeconds: oidc.maxAuthenticationAgeSeconds,
    });
    return Object.freeze({
      ...base,
      ...(localAccounts === undefined ? {} : { localAccounts }),
      settings,
      provider: Object.freeze({
        issuer: settings.issuer,
        clientId: settings.clientId,
        redirectUri: settings.redirectUri,
        clientAuthentication:
          oidc.clientAuthentication === "NONE"
            ? Object.freeze({ method: "NONE" as const })
            : Object.freeze({
                method: "CLIENT_SECRET_BASIC" as const,
                secret: clientSecretSchema.parse(clientSecret),
              }),
        mfa: Object.freeze({
          acceptedAcrValues: Object.freeze([...oidc.acceptedAcrValues]),
          requiredAmrValues: Object.freeze([...oidc.requiredAmrValues]),
        }),
        maxAuthenticationAgeSeconds: settings.maxAuthenticationAgeSeconds,
      }),
    });
  } catch {
    throw new TypeError("Invalid admin runtime configuration");
  }
}
