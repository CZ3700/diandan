import { z } from "zod";

import {
  containsC0C1OrDelControlCharacter,
  portErrorBaseShape,
  portTimestampSchema,
  validatePortErrorPolicy,
} from "./port-common.js";
import { publicHttpsUrlSchema } from "./presentation.js";
import { schemaVersionSchema } from "./versioning.js";

export const identityPortOperationSchema = z.enum([
  "CREATE_AUTHORIZATION_REQUEST",
  "EXCHANGE_AUTHORIZATION_CODE",
]);
export const identityPortErrorCodeSchema = z.enum([
  "INVALID_COMMAND",
  "STATE_MISMATCH",
  "INVALID_AUTHORIZATION_CODE",
  "INVALID_ID_TOKEN",
  "NONCE_MISMATCH",
  "AUTHENTICATION_FAILED",
  "ACCESS_DENIED",
  "RATE_LIMITED",
  "TEMPORARY_UNAVAILABLE",
  "EXCHANGE_OUTCOME_UNKNOWN",
  "CONFIGURATION_ERROR",
  "MALFORMED_PROVIDER_RESPONSE",
  "UNEXPECTED_ADAPTER_FAILURE",
]);
export const identityPortErrorSchema = z
  .strictObject({
    ...portErrorBaseShape,
    code: identityPortErrorCodeSchema,
  })
  .superRefine((error, context) => {
    if (
      ["EXCHANGE_OUTCOME_UNKNOWN", "MALFORMED_PROVIDER_RESPONSE"].includes(
        error.code,
      )
    ) {
      if (
        error.recovery !== "RESTART_AUTHORIZATION" ||
        error.retryAfterMs !== undefined
      ) {
        context.addIssue({
          code: "custom",
          path: ["recovery"],
          message:
            "an ambiguous one-time authorization exchange must restart authorization",
        });
      }
      return;
    }
    validatePortErrorPolicy(error, context, {
      retryableCodes: [
        "RATE_LIMITED",
        "TEMPORARY_UNAVAILABLE",
        "UNEXPECTED_ADAPTER_FAILURE",
      ],
    });
  });

const oidcIssuerSchema = publicHttpsUrlSchema.refine(
  (value) => {
    const url = new URL(value);
    return url.search === "" && url.hash === "";
  },
  { message: "OIDC issuer must not contain query or fragment components" },
);
const oidcRedirectUriSchema = publicHttpsUrlSchema.refine(
  (value) => new URL(value).hash === "",
  { message: "OIDC redirect URI must not contain a fragment" },
);
const oidcCorrelationValueSchema = z
  .string()
  .min(43)
  .max(512)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._~:/+=-]*$/u);
const oidcOpaqueValueSchema = z
  .string()
  .min(1)
  .max(1_024)
  .refine((value) => !containsC0C1OrDelControlCharacter(value), {
    message: "OIDC opaque values must not contain control characters",
  });
export const oidcPkceCodeChallengeSchema = z
  .string()
  .length(43)
  .regex(/^[A-Za-z0-9_-]+$/u)
  .refine(
    (value) =>
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".indexOf(
        value.at(-1) ?? "",
      ) %
        4 ===
      0,
    { message: "PKCE SHA-256 challenge must be canonical base64url" },
  );
export const oidcPkceCodeVerifierSchema = z
  .string()
  .min(43)
  .max(128)
  .regex(/^[A-Za-z0-9._~-]+$/u);
const authorizationRequestCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("CREATE_AUTHORIZATION_REQUEST"),
  issuer: oidcIssuerSchema,
  clientId: oidcOpaqueValueSchema,
  redirectUri: oidcRedirectUriSchema,
  state: oidcCorrelationValueSchema,
  nonce: oidcCorrelationValueSchema,
  codeChallenge: oidcPkceCodeChallengeSchema,
  requestedAt: portTimestampSchema,
});
const exchangeCodeCommandSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("EXCHANGE_AUTHORIZATION_CODE"),
  issuer: oidcIssuerSchema,
  clientId: oidcOpaqueValueSchema,
  redirectUri: oidcRedirectUriSchema,
  code: oidcOpaqueValueSchema,
  state: oidcCorrelationValueSchema,
  expectedState: oidcCorrelationValueSchema,
  nonce: oidcCorrelationValueSchema,
  codeVerifier: oidcPkceCodeVerifierSchema,
  receivedAt: portTimestampSchema,
});
export const identityPortCommandSchema = z.discriminatedUnion("operation", [
  authorizationRequestCommandSchema,
  exchangeCodeCommandSchema,
]);

const failureSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    operation: identityPortOperationSchema,
    outcome: z.literal("FAILURE"),
    error: identityPortErrorSchema,
  })
  .superRefine((failure, context) => {
    if (
      failure.error.code === "EXCHANGE_OUTCOME_UNKNOWN" &&
      failure.operation !== "EXCHANGE_AUTHORIZATION_CODE"
    ) {
      context.addIssue({
        code: "custom",
        path: ["error", "code"],
        message: "exchange outcome ambiguity is valid only for code exchange",
      });
    }
  });
const authorizationRequestSuccessSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("CREATE_AUTHORIZATION_REQUEST"),
  outcome: z.literal("SUCCESS"),
  value: z.strictObject({
    authorizationUrl: publicHttpsUrlSchema,
    state: oidcCorrelationValueSchema,
    expiresAt: portTimestampSchema,
  }),
});
const exchangeCodeSuccessSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  operation: z.literal("EXCHANGE_AUTHORIZATION_CODE"),
  outcome: z.literal("SUCCESS"),
  value: z.strictObject({
    principal: z.strictObject({
      issuer: oidcIssuerSchema,
      subject: oidcOpaqueValueSchema,
      authenticatedAt: portTimestampSchema,
      mfa: z.boolean(),
    }),
  }),
});
export const identityPortResponseSchema = z.union([
  authorizationRequestSuccessSchema,
  exchangeCodeSuccessSchema,
  failureSchema,
]);

export type IdentityPortCommand = z.infer<typeof identityPortCommandSchema>;
export type IdentityPortResponse = z.infer<typeof identityPortResponseSchema>;
export type IdentityPortError = z.infer<typeof identityPortErrorSchema>;
export type IdentityPortFailure = z.infer<typeof failureSchema>;
type IdentityFailureFor<Operation extends IdentityPortCommand["operation"]> =
  Omit<IdentityPortFailure, "operation"> & Readonly<{ operation: Operation }>;
export type CreateAuthorizationRequestCommand = z.infer<
  typeof authorizationRequestCommandSchema
>;
export type CreateAuthorizationRequestResponse =
  | Extract<IdentityPortResponse, { operation: "CREATE_AUTHORIZATION_REQUEST" }>
  | IdentityFailureFor<"CREATE_AUTHORIZATION_REQUEST">;
export type ExchangeAuthorizationCodeCommand = z.infer<
  typeof exchangeCodeCommandSchema
>;
export type ExchangeAuthorizationCodeResponse =
  | Extract<IdentityPortResponse, { operation: "EXCHANGE_AUTHORIZATION_CODE" }>
  | IdentityFailureFor<"EXCHANGE_AUTHORIZATION_CODE">;
