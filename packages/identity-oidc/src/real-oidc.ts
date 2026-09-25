import { Buffer } from "node:buffer";

import {
  identityPortCommandSchema,
  identityPortResponseSchema,
  type IdentityPortCommand,
  type IdentityPortError,
  type IdentityPortFailure,
  type IdentityProvider,
} from "@fan-support/identity-port";
import * as oidc from "openid-client";

export type OidcIdentityProviderOptions = Readonly<{
  issuer: string;
  clientId: string;
  redirectUri: string;
  clientAuthentication:
    | Readonly<{ method: "NONE" }>
    | Readonly<{ method: "CLIENT_SECRET_BASIC"; secret: string }>;
  /** Both conditions are required when both lists are configured. */
  mfa: Readonly<{
    acceptedAcrValues: readonly string[];
    requiredAmrValues: readonly string[];
  }>;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
  maxAuthenticationAgeSeconds?: number;
  /** Allowed claim clock tolerance, not a clock offset. Defaults to zero. */
  clockSkewSeconds?: number;
}>;

export type OidcIdentityProviderDependencies = Readonly<{
  /** Scoped TLS transport injection; the default is the platform HTTPS fetch. */
  fetch?: typeof fetch;
  now?: () => Date;
}>;

type Settings = ReturnType<typeof parseSettings>;
type Operation = IdentityPortCommand["operation"];
type ErrorCode = IdentityPortError["code"];
const providerUrlSchema =
  identityPortCommandSchema.options[0].shape.redirectUri;

class TransportFailure extends Error {
  constructor(
    readonly kind: "NETWORK" | "MALFORMED" | "RATE_LIMITED" | "UNAVAILABLE",
  ) {
    super("OIDC transport failed");
  }
}

function validHttps(value: unknown): value is string {
  return providerUrlSchema.safeParse(value).success;
}

function integerOption(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < min || result > max)
    throw new Error("Invalid OIDC configuration");
  return result;
}

function parseSettings(options: OidcIdentityProviderOptions) {
  try {
    const parsed = identityPortCommandSchema.safeParse({
      schemaVersion: 1,
      operation: "CREATE_AUTHORIZATION_REQUEST",
      issuer: options.issuer,
      clientId: options.clientId,
      redirectUri: options.redirectUri,
      state: "s".repeat(43),
      nonce: "n".repeat(43),
      codeChallenge: "A".repeat(43),
      requestedAt: "2026-01-01T00:00:00Z",
    });
    // openid-client strips callback query parameters when building redirect_uri.
    // Reject that configuration rather than silently exchange with another URI.
    if (
      !parsed.success ||
      new URL(options.redirectUri).search ||
      new URL(options.issuer).pathname.includes("/.well-known/")
    )
      throw new Error();
    const { acceptedAcrValues, requiredAmrValues } = options.mfa;
    for (const values of [acceptedAcrValues, requiredAmrValues]) {
      if (
        !Array.isArray(values) ||
        values.length > 32 ||
        new Set(values).size !== values.length ||
        values.some(
          (value) =>
            typeof value !== "string" ||
            value.length < 1 ||
            value.length > 256 ||
            /\s/u.test(value) ||
            [...value].some((character) => {
              const code = character.charCodeAt(0);
              return code < 32 || (code >= 127 && code <= 159);
            }),
        )
      )
        throw new Error();
    }
    if (acceptedAcrValues.length + requiredAmrValues.length === 0)
      throw new Error();
    const authentication = options.clientAuthentication;
    if (
      authentication.method !== "NONE" &&
      authentication.method !== "CLIENT_SECRET_BASIC"
    )
      throw new Error();
    if (
      authentication.method === "CLIENT_SECRET_BASIC" &&
      (typeof authentication.secret !== "string" ||
        authentication.secret.length < 1 ||
        authentication.secret.length > 4096)
    )
      throw new Error();
    return {
      issuer: options.issuer,
      clientId: options.clientId,
      redirectUri: options.redirectUri,
      clientAuthentication: { ...authentication },
      acceptedAcrValues: [...acceptedAcrValues],
      requiredAmrValues: [...requiredAmrValues],
      requestTimeoutMs: integerOption(
        options.requestTimeoutMs,
        5000,
        100,
        30000,
      ),
      maxResponseBytes: integerOption(
        options.maxResponseBytes,
        262144,
        1024,
        1048576,
      ),
      maxAuthenticationAgeSeconds: integerOption(
        options.maxAuthenticationAgeSeconds,
        300,
        1,
        3600,
      ),
      clockSkewSeconds: integerOption(options.clockSkewSeconds, 0, 0, 30),
    };
  } catch {
    // Never include supplied configuration or credentials in an exception.
    throw new Error("Invalid OIDC configuration");
  }
}

function failure<T extends Operation>(
  operation: T,
  code: ErrorCode,
): IdentityPortFailure & { operation: T } {
  const retryable = [
    "RATE_LIMITED",
    "TEMPORARY_UNAVAILABLE",
    "UNEXPECTED_ADAPTER_FAILURE",
  ].includes(code);
  const restart =
    code === "EXCHANGE_OUTCOME_UNKNOWN" ||
    code === "MALFORMED_PROVIDER_RESPONSE";
  return {
    schemaVersion: 1,
    operation,
    outcome: "FAILURE",
    error: {
      schemaVersion: 1,
      code,
      recovery: restart
        ? "RESTART_AUTHORIZATION"
        : retryable
          ? "RETRY_SAME_COMMAND"
          : "NONE",
      ...(retryable ? { retryAfterMs: 1000 } : {}),
    },
  };
}

/** Bounds headers and the complete streamed body, including chunked responses. */
function boundedFetch(
  settings: Settings,
  transport: typeof fetch,
): oidc.CustomFetch {
  return async (url, options) => {
    if (!validHttps(url)) throw new TransportFailure("MALFORMED");
    const controller = new AbortController();
    const signal = options.signal
      ? AbortSignal.any([controller.signal, options.signal])
      : controller.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new TransportFailure("NETWORK"));
      }, settings.requestTimeoutMs);
    });
    try {
      return await Promise.race([
        deadline,
        (async () => {
          const { body, ...requestOptions } = options;
          const response = await transport(url, {
            ...requestOptions,
            ...(body === undefined ? {} : { body }),
            redirect: "manual",
            signal,
          });
          if (response.status === 429)
            throw new TransportFailure("RATE_LIMITED");
          if (response.status >= 500) throw new TransportFailure("UNAVAILABLE");
          if (response.status >= 300 && response.status < 400)
            throw new TransportFailure("MALFORMED");
          const length = response.headers.get("content-length");
          if (
            length !== null &&
            (!/^\d+$/u.test(length) ||
              Number(length) > settings.maxResponseBytes)
          )
            throw new TransportFailure("MALFORMED");
          const reader = response.body?.getReader();
          const chunks: Uint8Array[] = [];
          let size = 0;
          if (reader) {
            try {
              for (;;) {
                const chunk = await reader.read();
                if (chunk.done) break;
                size += chunk.value.byteLength;
                if (size > settings.maxResponseBytes)
                  throw new TransportFailure("MALFORMED");
                chunks.push(chunk.value);
              }
            } finally {
              reader.releaseLock();
            }
          }
          return new Response(Buffer.concat(chunks), {
            status: response.status,
            headers: response.headers,
          });
        })(),
      ]);
    } catch (error) {
      if (error instanceof TransportFailure) throw error;
      throw new TransportFailure("NETWORK");
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
}

function nestedTransportFailure(error: unknown): TransportFailure | undefined {
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (current instanceof TransportFailure) return current;
    if (!(current instanceof Error)) break;
    current = current.cause;
  }
  return undefined;
}

function discoveryError(error: unknown): ErrorCode {
  const transport = nestedTransportFailure(error);
  if (transport?.kind === "RATE_LIMITED") return "RATE_LIMITED";
  if (transport && transport.kind !== "MALFORMED")
    return "TEMPORARY_UNAVAILABLE";
  return "CONFIGURATION_ERROR";
}

function isNonceFailure(error: Error): boolean {
  let cause: unknown = error.cause;
  for (let depth = 0; depth < 5; depth += 1) {
    if (
      cause &&
      typeof cause === "object" &&
      "claim" in cause &&
      cause.claim === "nonce"
    )
      return true;
    if (!(cause instanceof Error)) return false;
    cause = cause.cause;
  }
  return false;
}

function exchangeError(error: unknown): ErrorCode {
  const transport = nestedTransportFailure(error);
  if (transport)
    return transport.kind === "MALFORMED"
      ? "MALFORMED_PROVIDER_RESPONSE"
      : "EXCHANGE_OUTCOME_UNKNOWN";
  if (
    error instanceof oidc.ResponseBodyError ||
    error instanceof oidc.AuthorizationResponseError
  ) {
    switch (error.error) {
      case "invalid_grant":
        return "INVALID_AUTHORIZATION_CODE";
      case "access_denied":
        return "ACCESS_DENIED";
      case "invalid_client":
      case "unauthorized_client":
        return "CONFIGURATION_ERROR";
      default:
        return "EXCHANGE_OUTCOME_UNKNOWN";
    }
  }
  if (error instanceof oidc.ClientError) {
    if (
      error.code === "OAUTH_PARSE_ERROR" ||
      error.code === "OAUTH_RESPONSE_IS_NOT_JSON" ||
      error.code === "OAUTH_RESPONSE_IS_NOT_CONFORM"
    )
      return "MALFORMED_PROVIDER_RESPONSE";
    // Only inspect this fixed SDK discriminator; never return claims or causes.
    if (
      error.code === "OAUTH_JWT_CLAIM_COMPARISON_FAILED" &&
      isNonceFailure(error)
    )
      return "NONCE_MISMATCH";
    if (error.code === "OAUTH_TIMEOUT" || error.code === "OAUTH_ABORT")
      return "EXCHANGE_OUTCOME_UNKNOWN";
    return "INVALID_ID_TOKEN";
  }
  return "EXCHANGE_OUTCOME_UNKNOWN";
}

function assertMetadata(config: oidc.Configuration, settings: Settings): void {
  const metadata = config.serverMetadata();
  if (
    metadata.issuer !== settings.issuer ||
    !validHttps(metadata.authorization_endpoint) ||
    !validHttps(metadata.token_endpoint) ||
    !validHttps(metadata.jwks_uri) ||
    !metadata.response_types_supported?.includes("code") ||
    !metadata.code_challenge_methods_supported?.includes("S256") ||
    !metadata.id_token_signing_alg_values_supported?.includes("RS256")
  )
    throw new Error("Invalid OIDC metadata");
  const method =
    settings.clientAuthentication.method === "NONE"
      ? "none"
      : "client_secret_basic";
  if (
    metadata.token_endpoint_auth_methods_supported &&
    !metadata.token_endpoint_auth_methods_supported.includes(method)
  )
    throw new Error("Invalid OIDC metadata");
}

function matchesConfiguration(
  command: IdentityPortCommand,
  settings: Settings,
): boolean {
  return (
    command.issuer === settings.issuer &&
    command.clientId === settings.clientId &&
    command.redirectUri === settings.redirectUri
  );
}

function validClaims(
  claims: oidc.IDToken,
  settings: Settings,
  now: number,
): boolean {
  const skew = settings.clockSkewSeconds;
  return (
    claims.iss === settings.issuer &&
    (claims.azp === undefined || claims.azp === settings.clientId) &&
    Number.isSafeInteger(claims.exp) &&
    claims.exp > now - skew &&
    Number.isSafeInteger(claims.iat) &&
    claims.iat <= now + skew &&
    typeof claims.auth_time === "number" &&
    Number.isSafeInteger(claims.auth_time) &&
    claims.auth_time >= 0 &&
    claims.auth_time <= now + skew &&
    claims.auth_time <= claims.iat + skew &&
    claims.auth_time + settings.maxAuthenticationAgeSeconds >= now - skew
  );
}

function provesMfa(claims: oidc.IDToken, settings: Settings): boolean {
  const acr = claims["acr"];
  const amr = claims["amr"];
  return (
    (settings.acceptedAcrValues.length === 0 ||
      (typeof acr === "string" && settings.acceptedAcrValues.includes(acr))) &&
    (settings.requiredAmrValues.length === 0 ||
      (Array.isArray(amr) &&
        amr.every((value) => typeof value === "string") &&
        settings.requiredAmrValues.every((value) => amr?.includes(value))))
  );
}

/** OIDC authentication only. Platform roles and session issuance belong above this port. */
export function createOidcIdentityProvider(
  options: OidcIdentityProviderOptions,
  dependencies: OidcIdentityProviderDependencies = {},
): IdentityProvider {
  const settings = parseSettings(options);
  const transport = boundedFetch(
    settings,
    dependencies.fetch ?? globalThis.fetch,
  );
  const now = dependencies.now ?? (() => new Date());
  let configuration: Promise<oidc.Configuration> | undefined;
  const discover = () =>
    (configuration ??= oidc
      .discovery(
        new URL(settings.issuer),
        settings.clientId,
        {
          id_token_signed_response_alg: "RS256",
          require_auth_time: true,
          default_max_age: settings.maxAuthenticationAgeSeconds,
          [oidc.clockTolerance]: settings.clockSkewSeconds,
        },
        settings.clientAuthentication.method === "NONE"
          ? oidc.None()
          : oidc.ClientSecretBasic(settings.clientAuthentication.secret),
        {
          [oidc.customFetch]: transport,
          timeout: settings.requestTimeoutMs / 1000,
          execute: [oidc.enableNonRepudiationChecks],
        },
      )
      .then((config) => {
        assertMetadata(config, settings);
        return config;
      })
      .catch((error) => {
        configuration = undefined;
        throw error;
      }));

  return {
    async createAuthorizationRequest(input) {
      const parsed = identityPortCommandSchema.safeParse(input);
      if (
        !parsed.success ||
        parsed.data.operation !== "CREATE_AUTHORIZATION_REQUEST" ||
        !matchesConfiguration(parsed.data, settings)
      )
        return failure("CREATE_AUTHORIZATION_REQUEST", "INVALID_COMMAND");
      const command = parsed.data;
      const expires = new Date(
        Math.min(Date.parse(command.requestedAt), now().getTime()) + 300000,
      );
      if (
        !Number.isFinite(expires.getTime()) ||
        expires.getTime() <= now().getTime()
      )
        return failure(command.operation, "INVALID_COMMAND");
      try {
        const config = await discover();
        const url = oidc.buildAuthorizationUrl(config, {
          response_type: "code",
          redirect_uri: settings.redirectUri,
          scope: "openid",
          state: command.state,
          nonce: command.nonce,
          code_challenge: command.codeChallenge,
          code_challenge_method: "S256",
          max_age: String(settings.maxAuthenticationAgeSeconds),
          ...(settings.acceptedAcrValues.length
            ? { acr_values: settings.acceptedAcrValues.join(" ") }
            : {}),
        });
        const response = identityPortResponseSchema.safeParse({
          schemaVersion: 1,
          operation: command.operation,
          outcome: "SUCCESS",
          value: {
            authorizationUrl: url.href,
            state: command.state,
            expiresAt: expires.toISOString(),
          },
        });
        if (
          !response.success ||
          response.data.operation !== command.operation ||
          response.data.outcome !== "SUCCESS"
        )
          return failure(command.operation, "CONFIGURATION_ERROR");
        return response.data;
      } catch (error) {
        return failure(command.operation, discoveryError(error));
      }
    },
    async exchangeAuthorizationCode(input) {
      const parsed = identityPortCommandSchema.safeParse(input);
      if (
        !parsed.success ||
        parsed.data.operation !== "EXCHANGE_AUTHORIZATION_CODE" ||
        !matchesConfiguration(parsed.data, settings)
      )
        return failure("EXCHANGE_AUTHORIZATION_CODE", "INVALID_COMMAND");
      const command = parsed.data;
      if (command.state !== command.expectedState)
        return failure(command.operation, "STATE_MISMATCH");
      let config: oidc.Configuration;
      try {
        config = await discover();
      } catch (error) {
        return failure(command.operation, discoveryError(error));
      }
      try {
        const callback = new URL(settings.redirectUri);
        callback.searchParams.set("code", command.code);
        callback.searchParams.set("state", command.state);
        callback.searchParams.set("iss", settings.issuer);
        // No DPoP: openid-client's sole grant retry path is a DPoP nonce retry.
        const tokens = await oidc.authorizationCodeGrant(config, callback, {
          expectedState: command.expectedState,
          expectedNonce: command.nonce,
          pkceCodeVerifier: command.codeVerifier,
          idTokenExpected: true,
          maxAge: settings.maxAuthenticationAgeSeconds,
        });
        const claims = tokens.claims();
        if (
          !claims ||
          !validClaims(claims, settings, Math.floor(now().getTime() / 1000))
        )
          return failure(command.operation, "INVALID_ID_TOKEN");
        if (!provesMfa(claims, settings))
          return failure(command.operation, "AUTHENTICATION_FAILED");
        const response = {
          schemaVersion: 1 as const,
          operation: command.operation,
          outcome: "SUCCESS" as const,
          value: {
            principal: {
              issuer: settings.issuer,
              subject: claims.sub,
              authenticatedAt: new Date(claims.auth_time! * 1000).toISOString(),
              mfa: true,
            },
          },
        };
        const result = identityPortResponseSchema.safeParse(response);
        if (
          !result.success ||
          result.data.operation !== command.operation ||
          result.data.outcome !== "SUCCESS"
        )
          return failure(command.operation, "INVALID_ID_TOKEN");
        return result.data;
      } catch (error) {
        return failure(command.operation, exchangeError(error));
      }
    },
  };
}
