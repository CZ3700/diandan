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
import {
  notificationPortCommandSchema,
  notificationPortResponseSchema,
  type NotificationProvider,
  type SendNotificationCommand,
  type SendNotificationResponse,
} from "@fan-support/notification-port";

import {
  DETERMINISTIC_NOW,
  deterministicIdentityAuthorizationCode,
} from "./fixtures.js";

function parsedResponse<Response>(
  schema: Readonly<{ parse(value: unknown): unknown }>,
  value: unknown,
): Response {
  return schema.parse(value) as Response;
}

export type FakeIdentityProviderOptions = Readonly<{
  now?: string;
  principalSubject?: string;
  mfa?: boolean;
  authorizationCode?: string;
}>;

export function createFakeIdentityProvider(
  options: FakeIdentityProviderOptions = {},
): IdentityProvider {
  const now = options.now ?? DETERMINISTIC_NOW;
  const principalSubject = options.principalSubject ?? "fixture-admin-subject";
  const mfa = options.mfa ?? true;
  const consumedAuthorizationCodes = new Set<string>();
  const authorizationRequests = new Map<
    string,
    Readonly<{
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
    }>
  >();

  function identityFailure<Response>(
    operation: "CREATE_AUTHORIZATION_REQUEST" | "EXCHANGE_AUTHORIZATION_CODE",
    code:
      | "INVALID_COMMAND"
      | "STATE_MISMATCH"
      | "INVALID_AUTHORIZATION_CODE"
      | "NONCE_MISMATCH",
  ): Response {
    return parsedResponse(identityPortResponseSchema, {
      schemaVersion: 1,
      operation,
      outcome: "FAILURE",
      error: { schemaVersion: 1, code, recovery: "NONE" },
    });
  }

  return Object.freeze({
    async createAuthorizationRequest(
      command: CreateAuthorizationRequestCommand,
    ): Promise<CreateAuthorizationRequestResponse> {
      const parsed = identityPortCommandSchema.safeParse(command);
      if (
        !parsed.success ||
        parsed.data.operation !== "CREATE_AUTHORIZATION_REQUEST"
      ) {
        return identityFailure(
          "CREATE_AUTHORIZATION_REQUEST",
          "INVALID_COMMAND",
        );
      }
      const fingerprint = JSON.stringify(parsed.data);
      const existing = authorizationRequests.get(parsed.data.state);
      if (existing !== undefined) {
        if (existing.fingerprint !== fingerprint) {
          return identityFailure(
            "CREATE_AUTHORIZATION_REQUEST",
            "INVALID_COMMAND",
          );
        }
        return parsedResponse(identityPortResponseSchema, {
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
          options.authorizationCode ??
          deterministicIdentityAuthorizationCode(parsed.data.state),
        consumed: false,
      });
      return parsedResponse(identityPortResponseSchema, {
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
        return identityFailure(
          "EXCHANGE_AUTHORIZATION_CODE",
          "INVALID_COMMAND",
        );
      }
      if (parsed.data.state !== parsed.data.expectedState) {
        return identityFailure("EXCHANGE_AUTHORIZATION_CODE", "STATE_MISMATCH");
      }
      const request = authorizationRequests.get(parsed.data.state);
      if (request === undefined) {
        return identityFailure("EXCHANGE_AUTHORIZATION_CODE", "STATE_MISMATCH");
      }
      if (request.nonce !== parsed.data.nonce) {
        return identityFailure("EXCHANGE_AUTHORIZATION_CODE", "NONCE_MISMATCH");
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
        return identityFailure(
          "EXCHANGE_AUTHORIZATION_CODE",
          "INVALID_AUTHORIZATION_CODE",
        );
      }
      authorizationRequests.set(parsed.data.state, {
        ...request,
        consumed: true,
      });
      consumedAuthorizationCodes.add(parsed.data.code);
      return parsedResponse(identityPortResponseSchema, {
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

export type FakeNotificationProviderOptions = Readonly<{
  now?: string;
  outcome?: "ACCEPTED" | "REJECTED" | "UNKNOWN";
}>;

export type FakeNotificationDelivery = Readonly<{
  schemaVersion: 1;
  notificationId: string;
  idempotencyKey: string;
  status: "ACCEPTED" | "REJECTED" | "UNKNOWN";
}>;

export function createFakeNotificationProviderHarness(
  options: FakeNotificationProviderOptions = {},
): Readonly<{
  provider: NotificationProvider;
  deliveries(): readonly FakeNotificationDelivery[];
}> {
  const now = options.now ?? DETERMINISTIC_NOW;
  const configuredOutcome = options.outcome ?? "ACCEPTED";
  const deliveryRecords: FakeNotificationDelivery[] = [];
  const attempts = new Map<
    string,
    Readonly<{ fingerprint: string; response: SendNotificationResponse }>
  >();

  const provider: NotificationProvider = Object.freeze({
    async sendNotification(
      command: SendNotificationCommand,
    ): Promise<SendNotificationResponse> {
      const parsed = notificationPortCommandSchema.safeParse(command);
      if (!parsed.success) {
        return parsedResponse(notificationPortResponseSchema, {
          schemaVersion: 1,
          operation: "SEND_NOTIFICATION",
          outcome: "FAILURE",
          error: {
            schemaVersion: 1,
            code: "INVALID_COMMAND",
            recovery: "NONE",
          },
        });
      }
      const idempotencyKey = parsed.data.notification.idempotencyKey;
      const fingerprint = JSON.stringify(parsed.data);
      const existing = attempts.get(idempotencyKey);
      if (existing !== undefined) {
        if (existing.fingerprint === fingerprint) {
          return existing.response;
        }
        return parsedResponse(notificationPortResponseSchema, {
          schemaVersion: 1,
          operation: "SEND_NOTIFICATION",
          outcome: "FAILURE",
          error: {
            schemaVersion: 1,
            code: "IDEMPOTENCY_CONFLICT",
            recovery: "NONE",
          },
        });
      }
      const providerReference = `fake-notification/${parsed.data.notification.id}`;
      let response: SendNotificationResponse;
      if (configuredOutcome === "ACCEPTED") {
        response = parsedResponse(notificationPortResponseSchema, {
          schemaVersion: 1,
          operation: "SEND_NOTIFICATION",
          outcome: "SUCCESS",
          value: { status: "ACCEPTED", providerReference, acceptedAt: now },
        });
      } else if (configuredOutcome === "UNKNOWN") {
        response = parsedResponse(notificationPortResponseSchema, {
          schemaVersion: 1,
          operation: "SEND_NOTIFICATION",
          outcome: "FAILURE",
          error: {
            schemaVersion: 1,
            code: "TIMEOUT_OUTCOME_UNKNOWN",
            recovery: "RETRY_SAME_COMMAND",
            retryAfterMs: 1_000,
          },
        });
      } else {
        response = parsedResponse(notificationPortResponseSchema, {
          schemaVersion: 1,
          operation: "SEND_NOTIFICATION",
          outcome: "SUCCESS",
          value: { status: "REJECTED" },
        });
      }
      deliveryRecords.push({
        schemaVersion: 1,
        notificationId: parsed.data.notification.id,
        idempotencyKey,
        status: configuredOutcome,
      });
      attempts.set(idempotencyKey, { fingerprint, response });
      return response;
    },
  });

  return Object.freeze({
    provider,
    deliveries: () =>
      Object.freeze(
        deliveryRecords.map((delivery) => Object.freeze({ ...delivery })),
      ),
  });
}

export function createFakeNotificationProvider(
  options: FakeNotificationProviderOptions = {},
): NotificationProvider {
  return createFakeNotificationProviderHarness(options).provider;
}
