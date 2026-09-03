/// <reference types="node" />

import { createHash } from "node:crypto";

import {
  identityPortCommandSchema,
  identityPortResponseSchema,
  type CreateAuthorizationRequestCommand,
  type CreateAuthorizationRequestResponse,
  type ExchangeAuthorizationCodeCommand,
  type ExchangeAuthorizationCodeResponse,
  type IdentityProvider,
} from "@fan-support/identity-port";

const DEFAULT_NOW = "2026-09-03T00:00:00.000Z";
const DEFAULT_PRINCIPAL_SUBJECT = "fixture-admin-subject";
const DEFAULT_FIXTURE_STATE = "fixture-state-000000000000000000000000000000";

type AuthorizationRequest = Readonly<{
  fingerprint: string;
  issuer: string;
  clientId: string;
  redirectUri: string;
  nonce: string;
  codeChallenge: string;
  authorizationUrl: string;
  expiresAt: string;
  expectedAuthorizationCode: string;
  consumed: boolean;
}>;

type IdentityFailureCode =
  | "INVALID_COMMAND"
  | "STATE_MISMATCH"
  | "INVALID_AUTHORIZATION_CODE"
  | "NONCE_MISMATCH";

function parsedResponse<Response>(value: unknown): Response {
  return identityPortResponseSchema.parse(value) as Response;
}

function failure<Response>(
  operation: "CREATE_AUTHORIZATION_REQUEST" | "EXCHANGE_AUTHORIZATION_CODE",
  code: IdentityFailureCode,
): Response {
  return parsedResponse({
    schemaVersion: 1,
    operation,
    outcome: "FAILURE",
    error: { schemaVersion: 1, code, recovery: "NONE" },
  });
}

function deterministicAuthorizationCode(state: string): string {
  return state === DEFAULT_FIXTURE_STATE
    ? "fixture-code"
    : `fixture-code/${state}`;
}

/** Explicit opt-in required because this adapter is synthetic and test-only. */
export type FakeIdentityProviderOptions = Readonly<{
  environment: "TEST";
  now?: string;
  principalSubject?: string;
  mfa?: boolean;
  authorizationCode?: string;
}>;

/**
 * Creates a deterministic, in-memory OIDC test double.
 *
 * This factory never contacts an identity provider and must not be composed
 * into preview, staging, or production runtimes.
 */
export function createFakeIdentityProvider(
  options: FakeIdentityProviderOptions,
): IdentityProvider {
  if (options?.environment !== "TEST") {
    throw new TypeError(
      "deterministic identity provider requires an explicit TEST environment",
    );
  }

  const now = options.now ?? DEFAULT_NOW;
  const principalSubject =
    options.principalSubject ?? DEFAULT_PRINCIPAL_SUBJECT;
  const mfa = options.mfa ?? true;
  const authorizationCode = options.authorizationCode;
  const consumedAuthorizationCodes = new Set<string>();
  const authorizationRequests = new Map<string, AuthorizationRequest>();

  return Object.freeze({
    async createAuthorizationRequest(
      command: CreateAuthorizationRequestCommand,
    ): Promise<CreateAuthorizationRequestResponse> {
      const parsed = identityPortCommandSchema.safeParse(command);
      if (
        !parsed.success ||
        parsed.data.operation !== "CREATE_AUTHORIZATION_REQUEST"
      ) {
        return failure("CREATE_AUTHORIZATION_REQUEST", "INVALID_COMMAND");
      }

      const fingerprint = JSON.stringify(parsed.data);
      const existing = authorizationRequests.get(parsed.data.state);
      if (existing !== undefined) {
        if (existing.fingerprint !== fingerprint) {
          return failure("CREATE_AUTHORIZATION_REQUEST", "INVALID_COMMAND");
        }
        return parsedResponse({
          schemaVersion: 1,
          operation: "CREATE_AUTHORIZATION_REQUEST",
          outcome: "SUCCESS",
          value: {
            authorizationUrl: existing.authorizationUrl,
            state: parsed.data.state,
            expiresAt: existing.expiresAt,
          },
        });
      }

      const authorizationUrl = new URL(
        `${parsed.data.issuer.replace(/\/$/u, "")}/authorize`,
      );
      authorizationUrl.search = new URLSearchParams({
        response_type: "code",
        client_id: parsed.data.clientId,
        redirect_uri: parsed.data.redirectUri,
        scope: "openid",
        state: parsed.data.state,
        nonce: parsed.data.nonce,
        code_challenge: parsed.data.codeChallenge,
        code_challenge_method: "S256",
      }).toString();
      const expiresAt = new Date(
        Date.parse(parsed.data.requestedAt) + 300_000,
      ).toISOString();
      authorizationRequests.set(parsed.data.state, {
        fingerprint,
        issuer: parsed.data.issuer,
        clientId: parsed.data.clientId,
        redirectUri: parsed.data.redirectUri,
        nonce: parsed.data.nonce,
        codeChallenge: parsed.data.codeChallenge,
        authorizationUrl: authorizationUrl.toString(),
        expiresAt,
        expectedAuthorizationCode:
          authorizationCode ??
          deterministicAuthorizationCode(parsed.data.state),
        consumed: false,
      });
      return parsedResponse({
        schemaVersion: 1,
        operation: "CREATE_AUTHORIZATION_REQUEST",
        outcome: "SUCCESS",
        value: {
          authorizationUrl: authorizationUrl.toString(),
          state: parsed.data.state,
          expiresAt,
        },
      });
    },

    async exchangeAuthorizationCode(
      command: ExchangeAuthorizationCodeCommand,
    ): Promise<ExchangeAuthorizationCodeResponse> {
      const parsed = identityPortCommandSchema.safeParse(command);
      if (
        !parsed.success ||
        parsed.data.operation !== "EXCHANGE_AUTHORIZATION_CODE"
      ) {
        return failure("EXCHANGE_AUTHORIZATION_CODE", "INVALID_COMMAND");
      }
      if (parsed.data.state !== parsed.data.expectedState) {
        return failure("EXCHANGE_AUTHORIZATION_CODE", "STATE_MISMATCH");
      }

      const request = authorizationRequests.get(parsed.data.state);
      if (request === undefined) {
        return failure("EXCHANGE_AUTHORIZATION_CODE", "STATE_MISMATCH");
      }
      if (request.nonce !== parsed.data.nonce) {
        return failure("EXCHANGE_AUTHORIZATION_CODE", "NONCE_MISMATCH");
      }

      const challenge = createHash("sha256")
        .update(parsed.data.codeVerifier, "ascii")
        .digest("base64url");
      if (
        request.consumed ||
        consumedAuthorizationCodes.has(parsed.data.code) ||
        request.issuer !== parsed.data.issuer ||
        request.clientId !== parsed.data.clientId ||
        request.redirectUri !== parsed.data.redirectUri ||
        parsed.data.code !== request.expectedAuthorizationCode ||
        request.codeChallenge !== challenge ||
        Date.parse(parsed.data.receivedAt) > Date.parse(request.expiresAt)
      ) {
        return failure(
          "EXCHANGE_AUTHORIZATION_CODE",
          "INVALID_AUTHORIZATION_CODE",
        );
      }

      authorizationRequests.set(parsed.data.state, {
        ...request,
        consumed: true,
      });
      consumedAuthorizationCodes.add(parsed.data.code);
      return parsedResponse({
        schemaVersion: 1,
        operation: "EXCHANGE_AUTHORIZATION_CODE",
        outcome: "SUCCESS",
        value: {
          principal: {
            issuer: parsed.data.issuer,
            subject: principalSubject,
            authenticatedAt: now,
            mfa,
          },
        },
      });
    },
  });
}

export const workspacePackageName = "@fan-support/identity-oidc" as const;
