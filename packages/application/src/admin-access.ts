/// <reference types="node" />
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  sourceHashSchema,
  adminAccessSettingsSchema,
  adminAccessBeginRequestSchema,
  adminAccessCallbackRequestSchema,
  adminAccessLogoutRequestSchema,
  adminAccessBeginResponseSchema,
  adminAccessCallbackResponseSchema,
  adminAccessLogoutResponseSchema,
  adminAccessCreateResponseSchema,
  adminAccessClaimResponseSchema,
  adminAccessCompleteResponseSchema,
  adminAccessRejectResponseSchema,
  identityPortResponseSchema,
  type AdminAccessSettings,
  type AdminAccessFailure,
  type AdminAccessBeginResponse,
  type AdminAccessCallbackResponse,
  type AdminAccessLogoutResponse,
  type AdminAccessRejectCommand,
} from "@fan-support/contracts";
import type { AdminAccessTransactionManager } from "@fan-support/persistence-port";
import type { IdentityProvider } from "@fan-support/identity-port";
import {
  digestAdminContentToken,
  validateAdminContentTokenPepper,
} from "./admin-content-tokens.js";
import {
  deriveAdminLoginProofs,
  digestAdminIdentitySubject,
  digestAdminLoginValue,
  equalAdminLoginState,
} from "./admin-access-tokens.js";

export type AdminAccessDependencies = Readonly<{
  settings: AdminAccessSettings;
  identityProvider: IdentityProvider;
  transactions: AdminAccessTransactionManager;
  tokenPepper: string;
  subjectPepper: string;
  now?: () => Date;
}>;
export type AdminAccessUseCases = Readonly<{
  begin(input: unknown): Promise<AdminAccessBeginResponse>;
  callback(input: unknown): Promise<AdminAccessCallbackResponse>;
  logout(input: unknown): Promise<AdminAccessLogoutResponse>;
}>;
const failure = (code: AdminAccessFailure["code"]): AdminAccessFailure => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code,
});
const token = () => randomBytes(32).toString("base64url");

/** Orchestrates the one-use login; identity exchange never holds a database transaction. */
export function createAdminAccessUseCases(
  dependencies: AdminAccessDependencies,
): AdminAccessUseCases {
  const settings = adminAccessSettingsSchema.parse(dependencies.settings);
  validateAdminContentTokenPepper(dependencies.tokenPepper);
  validateAdminContentTokenPepper(dependencies.subjectPepper);
  if (
    typeof dependencies.transactions?.runInAdminAccessTransaction !==
      "function" ||
    typeof dependencies.identityProvider?.exchangeAuthorizationCode !==
      "function" ||
    typeof dependencies.identityProvider?.createAuthorizationRequest !==
      "function"
  )
    throw new TypeError("Invalid admin access configuration");
  const now = dependencies.now ?? (() => new Date());
  const configurationDigest = sourceHashSchema.parse(
    createHash("sha256").update(JSON.stringify(settings)).digest("hex"),
  );
  const digest = (purpose: "state" | "binding" | "claim", value: string) =>
    digestAdminLoginValue(dependencies.tokenPepper, purpose, value);
  const sessionDigest = (
    purpose: "admin-session" | "admin-csrf",
    value: string,
  ) =>
    sourceHashSchema.parse(
      digestAdminContentToken({
        tokenPepper: dependencies.tokenPepper,
        purpose,
        token: value,
      }),
    );
  const oidc = {
    issuer: settings.issuer,
    clientId: settings.clientId,
    redirectUri: settings.redirectUri,
  };
  async function reject(command: AdminAccessRejectCommand): Promise<void> {
    await dependencies.transactions.runInAdminAccessTransaction(
      async ({ adminAccess }) =>
        adminAccessRejectResponseSchema.parse(
          await adminAccess.reject(command),
        ),
    );
  }
  return Object.freeze({
    async begin(input: unknown): Promise<AdminAccessBeginResponse> {
      const request = adminAccessBeginRequestSchema.safeParse(input);
      if (!request.success) return failure("INVALID_COMMAND");
      try {
        const browserToken = token(),
          proofs = deriveAdminLoginProofs(
            dependencies.tokenPepper,
            browserToken,
          ),
          requestedAt = now();
        const response = identityPortResponseSchema.parse(
          await dependencies.identityProvider.createAuthorizationRequest({
            schemaVersion: 1,
            operation: "CREATE_AUTHORIZATION_REQUEST",
            ...oidc,
            state: proofs.state,
            nonce: proofs.nonce,
            codeChallenge: createHash("sha256")
              .update(proofs.codeVerifier, "ascii")
              .digest("base64url"),
            requestedAt: requestedAt.toISOString(),
          }),
        );
        if (
          response.outcome !== "SUCCESS" ||
          response.operation !== "CREATE_AUTHORIZATION_REQUEST" ||
          response.value.state !== proofs.state
        )
          return failure("ACCESS_UNAVAILABLE");
        const ttlSeconds = Math.min(
          settings.loginTtlSeconds,
          Math.floor(
            (Date.parse(response.value.expiresAt) - now().getTime()) / 1000,
          ),
        );
        if (ttlSeconds < 30) return failure("ACCESS_UNAVAILABLE");
        const saved =
          await dependencies.transactions.runInAdminAccessTransaction(
            async ({ adminAccess }) =>
              adminAccessCreateResponseSchema.parse(
                await adminAccess.create({
                  schemaVersion: 1,
                  requestId: request.data.requestId,
                  challengeId: randomUUID(),
                  stateDigest: digest("state", proofs.state),
                  bindingDigest: digest("binding", browserToken),
                  configurationDigest,
                  locale: request.data.locale,
                  ttlSeconds,
                }),
              ),
          );
        if (saved.outcome === "FAILURE") return saved;
        return adminAccessBeginResponseSchema.parse({
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "LOGIN_REDIRECT",
          authorizationUrl: response.value.authorizationUrl,
          browserToken,
          expiresAt: saved.expiresAt,
        });
      } catch {
        return failure("ACCESS_UNAVAILABLE");
      }
    },
    async callback(input: unknown): Promise<AdminAccessCallbackResponse> {
      const request = adminAccessCallbackRequestSchema.safeParse(input);
      if (!request.success) return failure("INVALID_COMMAND");
      const proofs = deriveAdminLoginProofs(
        dependencies.tokenPepper,
        request.data.browserToken,
      );
      if (!equalAdminLoginState(request.data.state, proofs.state))
        return failure("LOGIN_RESTART_REQUIRED");
      let rejection: AdminAccessRejectCommand | undefined;
      try {
        const claimDigest = digest("claim", token());
        const claimed =
          await dependencies.transactions.runInAdminAccessTransaction(
            async ({ adminAccess }) =>
              adminAccessClaimResponseSchema.parse(
                await adminAccess.claim({
                  schemaVersion: 1,
                  requestId: request.data.requestId,
                  stateDigest: digest("state", proofs.state),
                  bindingDigest: digest("binding", request.data.browserToken),
                  configurationDigest,
                  claimDigest,
                }),
              ),
          );
        if (claimed.outcome === "FAILURE") return claimed;
        rejection = {
          schemaVersion: 1,
          requestId: request.data.requestId,
          challengeId: claimed.challengeId,
          claimDigest,
          reasonCode: "IDENTITY_REJECTED",
        };
        const response = identityPortResponseSchema.parse(
          await dependencies.identityProvider.exchangeAuthorizationCode({
            schemaVersion: 1,
            operation: "EXCHANGE_AUTHORIZATION_CODE",
            ...oidc,
            code: request.data.code,
            state: request.data.state,
            expectedState: proofs.state,
            nonce: proofs.nonce,
            codeVerifier: proofs.codeVerifier,
            receivedAt: now().toISOString(),
          }),
        );
        if (
          response.outcome !== "SUCCESS" ||
          response.operation !== "EXCHANGE_AUTHORIZATION_CODE" ||
          response.value.principal.issuer !== settings.issuer
        ) {
          await reject(rejection);
          return failure("LOGIN_RESTART_REQUIRED");
        }
        const principal = response.value.principal;
        if (!principal.mfa) {
          await reject({ ...rejection, reasonCode: "MFA_REQUIRED" });
          return failure("MFA_REQUIRED");
        }
        const age = now().getTime() - Date.parse(principal.authenticatedAt);
        if (age < 0 || age > settings.maxAuthenticationAgeSeconds * 1000) {
          await reject({ ...rejection, reasonCode: "AUTHENTICATION_EXPIRED" });
          return failure("LOGIN_RESTART_REQUIRED");
        }
        const sessionToken = token(),
          csrfToken = token();
        const saved =
          await dependencies.transactions.runInAdminAccessTransaction(
            async ({ adminAccess }) =>
              adminAccessCompleteResponseSchema.parse(
                await adminAccess.complete({
                  schemaVersion: 1,
                  requestId: request.data.requestId,
                  challengeId: claimed.challengeId,
                  claimDigest,
                  issuer: principal.issuer,
                  subjectDigest: digestAdminIdentitySubject({
                    subjectPepper: dependencies.subjectPepper,
                    issuer: principal.issuer,
                    subject: principal.subject,
                  }),
                  authenticatedAt: principal.authenticatedAt,
                  mfa: true,
                  sessionId: randomUUID(),
                  sessionTokenDigest: sessionDigest(
                    "admin-session",
                    sessionToken,
                  ),
                  csrfTokenDigest: sessionDigest("admin-csrf", csrfToken),
                  sessionTtlSeconds: settings.sessionTtlSeconds,
                  maxAuthenticationAgeSeconds:
                    settings.maxAuthenticationAgeSeconds,
                }),
              ),
          );
        if (saved.outcome === "FAILURE") return saved;
        return adminAccessCallbackResponseSchema.parse({
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "SESSION_CREATED",
          sessionToken,
          csrfToken,
          expiresAt: saved.expiresAt,
          locale: saved.locale,
        });
      } catch {
        if (rejection) {
          try {
            await reject(rejection);
          } catch {
            /* A consumed/claimed challenge can never be exchanged again. */
          }
          return failure("LOGIN_RESTART_REQUIRED");
        }
        return failure("ACCESS_UNAVAILABLE");
      }
    },
    async logout(input: unknown): Promise<AdminAccessLogoutResponse> {
      const request = adminAccessLogoutRequestSchema.safeParse(input);
      if (!request.success) return failure("INVALID_COMMAND");
      try {
        return await dependencies.transactions.runInAdminAccessTransaction(
          async ({ adminAccess }) =>
            adminAccessLogoutResponseSchema.parse(
              await adminAccess.revoke({
                schemaVersion: 1,
                requestId: request.data.requestId,
                sessionTokenDigest: sessionDigest(
                  "admin-session",
                  request.data.sessionToken,
                ),
                csrfTokenDigest: sessionDigest(
                  "admin-csrf",
                  request.data.csrfToken,
                ),
                revokeAll: request.data.revokeAll,
              }),
            ),
        );
      } catch {
        return failure("ACCESS_UNAVAILABLE");
      }
    },
  });
}
