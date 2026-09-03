import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  identityPortCommandSchema,
  identityPortResponseSchema,
  type CreateAuthorizationRequestCommand,
  type ExchangeAuthorizationCodeCommand,
} from "@fan-support/identity-port";
import {
  deterministicPortFixtures,
  loadReviewedProviderFixtureBundle,
  runIdentityProviderConformance,
} from "@fan-support/testing";

import * as identityOidc from "./index.js";

const REQUESTED_AT = "2026-09-03T00:00:00.000Z";
const AUTHENTICATED_AT = "2026-09-03T00:00:01.000Z";
const ISSUER = "https://identity.example.invalid/tenant";
const CLIENT_ID = "fan-support-admin";
const REDIRECT_URI = "https://admin.example.invalid/oidc/callback";
const STATE = "fixture-state-000000000000000000000000000000";
const NONCE = "fixture-nonce-000000000000000000000000000000";
const CODE_VERIFIER = "A".repeat(43);
const CODE_CHALLENGE = createHash("sha256")
  .update(CODE_VERIFIER, "ascii")
  .digest("base64url");

function createCommand(
  overrides: Partial<
    Record<keyof CreateAuthorizationRequestCommand, unknown>
  > = {},
): CreateAuthorizationRequestCommand {
  return identityPortCommandSchema.parse({
    schemaVersion: 1,
    operation: "CREATE_AUTHORIZATION_REQUEST",
    issuer: ISSUER,
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    state: STATE,
    nonce: NONCE,
    codeChallenge: CODE_CHALLENGE,
    requestedAt: REQUESTED_AT,
    ...overrides,
  }) as CreateAuthorizationRequestCommand;
}

function exchangeCommand(
  overrides: Partial<
    Record<keyof ExchangeAuthorizationCodeCommand, unknown>
  > = {},
): ExchangeAuthorizationCodeCommand {
  return identityPortCommandSchema.parse({
    schemaVersion: 1,
    operation: "EXCHANGE_AUTHORIZATION_CODE",
    issuer: ISSUER,
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    code: "fixture-code",
    state: STATE,
    expectedState: STATE,
    nonce: NONCE,
    codeVerifier: CODE_VERIFIER,
    receivedAt: REQUESTED_AT,
    ...overrides,
  }) as ExchangeAuthorizationCodeCommand;
}

function createProvider(
  overrides: Omit<identityOidc.FakeIdentityProviderOptions, "environment"> = {},
) {
  return identityOidc.createFakeIdentityProvider({
    environment: "TEST",
    now: AUTHENTICATED_AT,
    ...overrides,
  });
}

test("exposes the identity-oidc workspace boundary", () => {
  expect(identityOidc.workspacePackageName).toBe("@fan-support/identity-oidc");
});

test("exports a clearly named fake identity provider factory", () => {
  expect(
    (identityOidc as Readonly<Record<string, unknown>>)[
      "createFakeIdentityProvider"
    ],
  ).toBeTypeOf("function");
});

test("requires an explicit TEST environment opt-in", () => {
  expect(() =>
    identityOidc.createFakeIdentityProvider(
      {} as identityOidc.FakeIdentityProviderOptions,
    ),
  ).toThrow(/TEST environment/u);
  expect(() =>
    identityOidc.createFakeIdentityProvider({
      environment: "LIVE",
    } as unknown as identityOidc.FakeIdentityProviderOptions),
  ).toThrow(/TEST environment/u);
});

test.each([
  ["timestamp", { now: "not-a-timestamp" }],
  ["principal", { principalSubject: "" }],
  ["MFA flag", { mfa: "true" }],
  ["authorization code", { authorizationCode: "" }],
] as const)(
  "rejects an invalid runtime %s at construction",
  (_label, invalid) => {
    expect(() =>
      identityOidc.createFakeIdentityProvider({
        environment: "TEST",
        ...invalid,
      } as identityOidc.FakeIdentityProviderOptions),
    ).toThrow(/configuration/u);
  },
);

test("passes the shared identity provider conformance suite", async () => {
  const report = await runIdentityProviderConformance(
    identityOidc.createFakeIdentityProvider({ environment: "TEST" }),
  );

  expect(report.passed).toBe(true);
  expect(report.cases).toHaveLength(11);
});

test("matches the reviewed synthetic identity fixture", async () => {
  const fixtureBundle = await loadReviewedProviderFixtureBundle();
  const fixture = fixtureBundle.fixtures["identity-oidc.v1.json"];
  const commands = deterministicPortFixtures.identity;
  const provider = identityOidc.createFakeIdentityProvider({
    environment: "TEST",
  });

  const authorization = await provider.createAuthorizationRequest(
    commands.createAuthorizationRequest,
  );
  const exchange = await provider.exchangeAuthorizationCode(
    commands.exchangeAuthorizationCode,
  );

  expect(authorization).toMatchObject({
    outcome: "SUCCESS",
    value: {
      authorizationUrl: expect.stringContaining(fixture.authorizationEndpoint),
    },
  });
  expect(exchange).toMatchObject({
    outcome: "SUCCESS",
    value: {
      principal: {
        issuer: fixture.issuer,
        subject: fixture.principal.subject,
        authenticatedAt: fixture.principal.authenticatedAt,
        mfa: fixture.principal.mfa,
      },
    },
  });
});

describe("fake identity provider", () => {
  test("normalizes an unrepresentable authorization expiry without throwing", async () => {
    const provider = createProvider();
    const command = createCommand({
      requestedAt: "9999-12-31T23:59:59.999Z",
    });

    await expect(
      provider.createAuthorizationRequest(command),
    ).resolves.toMatchObject({
      operation: "CREATE_AUTHORIZATION_REQUEST",
      outcome: "FAILURE",
      error: { code: "INVALID_COMMAND", recovery: "NONE" },
    });
  });

  test("creates a bound authorization request with a deterministic lifetime", async () => {
    const provider = createProvider();
    const command = createCommand({
      state: "fixture/state+value-00000000000000000000000000",
    });

    const response = await provider.createAuthorizationRequest(command);

    expect(identityPortResponseSchema.safeParse(response).success).toBe(true);
    expect(response).toMatchObject({
      schemaVersion: 1,
      operation: "CREATE_AUTHORIZATION_REQUEST",
      outcome: "SUCCESS",
      value: {
        state: command.state,
        expiresAt: "2026-09-03T00:05:00.000Z",
      },
    });
    if (response.outcome !== "SUCCESS") {
      throw new Error("expected a successful authorization request");
    }
    const authorizationUrl = new URL(response.value.authorizationUrl);
    expect(`${authorizationUrl.origin}${authorizationUrl.pathname}`).toBe(
      "https://identity.example.invalid/tenant/authorize",
    );
    expect(Object.fromEntries(authorizationUrl.searchParams)).toEqual({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: "openid",
      state: command.state,
      nonce: NONCE,
      code_challenge: CODE_CHALLENGE,
      code_challenge_method: "S256",
    });
  });

  test("replays the same state deterministically", async () => {
    const provider = createProvider();
    const command = createCommand();

    const first = await provider.createAuthorizationRequest(command);
    const replay = await provider.createAuthorizationRequest(command);

    expect(replay).toEqual(first);
  });

  test("rejects a changed command that reuses an issued state", async () => {
    const provider = createProvider();
    const command = createCommand();
    await provider.createAuthorizationRequest(command);

    const response = await provider.createAuthorizationRequest(
      createCommand({
        state: command.state,
        nonce: "changed-nonce-000000000000000000000000000000",
      }),
    );

    expect(response).toMatchObject({
      operation: "CREATE_AUTHORIZATION_REQUEST",
      outcome: "FAILURE",
      error: { code: "INVALID_COMMAND", recovery: "NONE" },
    });
  });

  test("returns operation-bound failures for malformed commands", async () => {
    const provider = createProvider();

    await expect(
      provider.createAuthorizationRequest({
        ...createCommand(),
        schemaVersion: 2,
      } as unknown as CreateAuthorizationRequestCommand),
    ).resolves.toMatchObject({
      operation: "CREATE_AUTHORIZATION_REQUEST",
      outcome: "FAILURE",
      error: { code: "INVALID_COMMAND" },
    });
    await expect(
      provider.exchangeAuthorizationCode(
        createCommand() as unknown as ExchangeAuthorizationCodeCommand,
      ),
    ).resolves.toMatchObject({
      operation: "EXCHANGE_AUTHORIZATION_CODE",
      outcome: "FAILURE",
      error: { code: "INVALID_COMMAND" },
    });
  });

  test("requires an issued state and the caller's expected state", async () => {
    const provider = createProvider();

    await expect(
      provider.exchangeAuthorizationCode(exchangeCommand()),
    ).resolves.toMatchObject({
      outcome: "FAILURE",
      error: { code: "STATE_MISMATCH" },
    });
    await provider.createAuthorizationRequest(createCommand());
    await expect(
      provider.exchangeAuthorizationCode(
        exchangeCommand({
          expectedState: "different-state-0000000000000000000000000000",
        }),
      ),
    ).resolves.toMatchObject({
      outcome: "FAILURE",
      error: { code: "STATE_MISMATCH" },
    });
  });

  test("reports a nonce mismatch without consuming the code", async () => {
    const provider = createProvider();
    await provider.createAuthorizationRequest(createCommand());

    await expect(
      provider.exchangeAuthorizationCode(
        exchangeCommand({
          nonce: "different-nonce-0000000000000000000000000000",
        }),
      ),
    ).resolves.toMatchObject({
      outcome: "FAILURE",
      error: { code: "NONCE_MISMATCH" },
    });
    await expect(
      provider.exchangeAuthorizationCode(exchangeCommand()),
    ).resolves.toMatchObject({ outcome: "SUCCESS" });
  });

  test("binds code exchange to issuer, client, redirect, PKCE, code, and expiry", async () => {
    const provider = createProvider();
    await provider.createAuthorizationRequest(createCommand());
    const invalidCommands = [
      exchangeCommand({ issuer: "https://other.example.invalid" }),
      exchangeCommand({ clientId: "other-client" }),
      exchangeCommand({
        redirectUri: "https://other-admin.example.invalid/oidc/callback",
      }),
      exchangeCommand({ code: "wrong-code" }),
      exchangeCommand({ codeVerifier: "B".repeat(43) }),
      exchangeCommand({ receivedAt: "2026-09-03T00:05:00.001Z" }),
    ];

    for (const invalidCommand of invalidCommands) {
      await expect(
        provider.exchangeAuthorizationCode(invalidCommand),
      ).resolves.toMatchObject({
        outcome: "FAILURE",
        error: { code: "INVALID_AUTHORIZATION_CODE" },
      });
    }
    await expect(
      provider.exchangeAuthorizationCode(exchangeCommand()),
    ).resolves.toMatchObject({ outcome: "SUCCESS" });
  });

  test("returns only the normalized principal contract", async () => {
    const provider = createProvider({
      principalSubject: "synthetic-admin-subject",
      mfa: false,
    });
    await provider.createAuthorizationRequest(createCommand());

    const response =
      await provider.exchangeAuthorizationCode(exchangeCommand());

    expect(identityPortResponseSchema.safeParse(response).success).toBe(true);
    expect(response).toEqual({
      schemaVersion: 1,
      operation: "EXCHANGE_AUTHORIZATION_CODE",
      outcome: "SUCCESS",
      value: {
        principal: {
          issuer: ISSUER,
          subject: "synthetic-admin-subject",
          authenticatedAt: AUTHENTICATED_AT,
          mfa: false,
        },
      },
    });
    expect(JSON.stringify(response)).not.toMatch(/email|displayName|token/iu);
  });

  test("consumes an authorization request and its code exactly once", async () => {
    const provider = createProvider();
    await provider.createAuthorizationRequest(createCommand());

    await expect(
      provider.exchangeAuthorizationCode(exchangeCommand()),
    ).resolves.toMatchObject({ outcome: "SUCCESS" });
    await expect(
      provider.exchangeAuthorizationCode(exchangeCommand()),
    ).resolves.toMatchObject({
      outcome: "FAILURE",
      error: { code: "INVALID_AUTHORIZATION_CODE" },
    });
  });

  test("prevents one code from succeeding for two distinct states", async () => {
    const sharedCode = "shared-authorization-code";
    const provider = createProvider({ authorizationCode: sharedCode });
    const secondState = "second-state-0000000000000000000000000000000";
    const secondNonce = "second-nonce-0000000000000000000000000000000";
    await provider.createAuthorizationRequest(createCommand());
    await provider.createAuthorizationRequest(
      createCommand({ state: secondState, nonce: secondNonce }),
    );

    await expect(
      provider.exchangeAuthorizationCode(exchangeCommand({ code: sharedCode })),
    ).resolves.toMatchObject({ outcome: "SUCCESS" });
    await expect(
      provider.exchangeAuthorizationCode(
        exchangeCommand({
          code: sharedCode,
          state: secondState,
          expectedState: secondState,
          nonce: secondNonce,
        }),
      ),
    ).resolves.toMatchObject({
      outcome: "FAILURE",
      error: { code: "INVALID_AUTHORIZATION_CODE" },
    });
  });

  test("snapshots deterministic options when the provider is created", async () => {
    const mutableOptions = {
      environment: "TEST" as const,
      now: AUTHENTICATED_AT,
      principalSubject: "original-subject",
      mfa: true,
      authorizationCode: "original-code",
    };
    const provider = identityOidc.createFakeIdentityProvider(mutableOptions);
    mutableOptions.now = "2026-09-03T02:00:00.000Z";
    mutableOptions.principalSubject = "changed-subject";
    mutableOptions.mfa = false;
    mutableOptions.authorizationCode = "changed-code";
    await provider.createAuthorizationRequest(createCommand());

    const response = await provider.exchangeAuthorizationCode(
      exchangeCommand({ code: "original-code" }),
    );

    expect(response).toMatchObject({
      outcome: "SUCCESS",
      value: {
        principal: {
          subject: "original-subject",
          authenticatedAt: AUTHENTICATED_AT,
          mfa: true,
        },
      },
    });
    expect(Object.isFrozen(provider)).toBe(true);
  });
});
