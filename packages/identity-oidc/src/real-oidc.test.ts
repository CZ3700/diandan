import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import {
  identityPortCommandSchema,
  identityPortResponseSchema,
  type CreateAuthorizationRequestCommand,
  type ExchangeAuthorizationCodeCommand,
  type IdentityPortResponse,
} from "@fan-support/identity-port";
import {
  createOidcIdentityProvider,
  type OidcIdentityProviderOptions,
} from "./real-oidc.js";
import {
  startTestOidcProvider,
  type TestOidcProvider,
} from "./test-support/https-idp.mjs";

const clientId = "local-admin-client";
const redirectUri = "https://admin.example.invalid/identity/callback";
const state = "s".repeat(43);
const nonce = "n".repeat(43);
const verifier = "v".repeat(43);
const challenge = createHash("sha256").update(verifier).digest("base64url");
let idp: TestOidcProvider;
let issuer: string;
let tlsFetch: typeof fetch;
beforeAll(async () => {
  idp = await startTestOidcProvider();
  issuer = idp.issuer;
  tlsFetch = idp.fetch;
});
beforeEach(() => idp.reset());
afterAll(async () => {
  await idp.stop();
});

function options(
  overrides: Partial<OidcIdentityProviderOptions> = {},
): OidcIdentityProviderOptions {
  return {
    issuer,
    clientId,
    redirectUri,
    clientAuthentication: { method: "NONE" },
    mfa: { acceptedAcrValues: ["urn:example:mfa"], requiredAmrValues: ["otp"] },
    ...overrides,
  };
}

function authorizationCommand(
  overrides: Partial<CreateAuthorizationRequestCommand> = {},
): CreateAuthorizationRequestCommand {
  return identityPortCommandSchema.parse({
    schemaVersion: 1,
    operation: "CREATE_AUTHORIZATION_REQUEST",
    issuer,
    clientId,
    redirectUri,
    state,
    nonce,
    codeChallenge: challenge,
    requestedAt: new Date().toISOString(),
    ...overrides,
  }) as CreateAuthorizationRequestCommand;
}

async function flow(overrides: Partial<OidcIdentityProviderOptions> = {}) {
  const provider = createOidcIdentityProvider(options(overrides), {
    fetch: tlsFetch,
  });
  const created = await provider.createAuthorizationRequest(
    authorizationCommand(),
  );
  expect(created.outcome).toBe("SUCCESS");
  if (created.outcome !== "SUCCESS")
    throw new Error("authorization fixture failed");
  const authorization = await tlsFetch(created.value.authorizationUrl);
  const callback = new URL(
    authorization.headers.get("location") ?? "https://invalid.example",
  );
  const command = identityPortCommandSchema.parse({
    schemaVersion: 1,
    operation: "EXCHANGE_AUTHORIZATION_CODE",
    issuer,
    clientId,
    redirectUri,
    code: callback.searchParams.get("code") ?? "",
    state,
    expectedState: state,
    nonce,
    codeVerifier: verifier,
    receivedAt: new Date().toISOString(),
  }) as ExchangeAuthorizationCodeCommand;
  return { provider, command, created };
}

function expectFailure(
  response: IdentityPortResponse,
  code: string,
  recovery = "NONE",
) {
  expect(identityPortResponseSchema.safeParse(response).success).toBe(true);
  expect(response).toEqual({
    schemaVersion: 1,
    operation: response.operation,
    outcome: "FAILURE",
    error: { schemaVersion: 1, code, recovery },
  });
}

test("real discovery and TLS code exchange bind S256, nonce, state and normalize only MFA identity", async () => {
  const { provider, command, created } = await flow();
  const url = new URL(created.value.authorizationUrl);
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    response_type: "code",
    scope: "openid",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    max_age: "300",
    acr_values: "urn:example:mfa",
  });
  const response = await provider.exchangeAuthorizationCode(command);
  expect(response.outcome).toBe("SUCCESS");
  expect(identityPortResponseSchema.safeParse(response).success).toBe(true);
  if (response.outcome === "SUCCESS")
    expect(response.value).toEqual({
      principal: {
        issuer,
        subject: "local-admin-subject",
        authenticatedAt: expect.any(String),
        mfa: true,
      },
    });
  expect(idp.tokenBody.get("grant_type")).toBe("authorization_code");
  expect(idp.tokenBody.get("code_verifier")).toBe(verifier);
  expect(idp.tokenBody.get("redirect_uri")).toBe(redirectUri);
  expect(idp.tokenBody.get("client_id")).toBe(clientId);
  expect(idp.discoveryRequests).toBe(1);
  expect(idp.tokenRequests).toBe(1);
  expectFailure(
    await provider.exchangeAuthorizationCode(command),
    "INVALID_AUTHORIZATION_CODE",
  );
});

test("confidential clients use only explicit client_secret_basic", async () => {
  const { provider, command } = await flow({
    clientAuthentication: {
      method: "CLIENT_SECRET_BASIC",
      secret: "local-test-secret",
    },
  });
  expect((await provider.exchangeAuthorizationCode(command)).outcome).toBe(
    "SUCCESS",
  );
  expect(idp.tokenAuthorization?.startsWith("Basic ")).toBe(true);
  expect(
    Buffer.from(idp.tokenAuthorization?.slice(6) ?? "", "base64")
      .toString()
      .split(":")
      .map(decodeURIComponent),
  ).toEqual([clientId, "local-test-secret"]);
  expect(idp.tokenBody.has("client_secret")).toBe(false);
});

test.each(["issuer", "clientId", "redirectUri"] as const)(
  "configured %s cannot be replaced by a command",
  async (field) => {
    const { provider, command } = await flow();
    expectFailure(
      await provider.exchangeAuthorizationCode({
        ...command,
        [field]:
          field === "clientId"
            ? "other-client"
            : "https://other.example.invalid",
      }),
      "INVALID_COMMAND",
    );
    expectFailure(
      await provider.createAuthorizationRequest({
        ...authorizationCommand(),
        [field]:
          field === "clientId"
            ? "other-client"
            : "https://other.example.invalid",
      }),
      "INVALID_COMMAND",
    );
    expect(idp.tokenRequests).toBe(0);
  },
);

test("state mismatch never exchanges an authorization code", async () => {
  const { provider, command } = await flow();
  expectFailure(
    await provider.exchangeAuthorizationCode({
      ...command,
      state: "x".repeat(43),
    }),
    "STATE_MISMATCH",
  );
  expect(idp.tokenRequests).toBe(0);
});

test("the provider actually checks PKCE", async () => {
  const { provider, command } = await flow();
  expectFailure(
    await provider.exchangeAuthorizationCode({
      ...command,
      codeVerifier: "z".repeat(43),
    }),
    "INVALID_AUTHORIZATION_CODE",
  );
});

test.each([
  ["WRONG_SIGNATURE", "INVALID_ID_TOKEN"],
  ["UNSIGNED", "INVALID_ID_TOKEN"],
  ["MISSING_ID_TOKEN", "INVALID_ID_TOKEN"],
] as const)(
  "rejects %s even on an authenticated TLS token endpoint",
  async (selected, expected) => {
    const { provider, command } = await flow();
    idp.setMode(selected);
    expectFailure(await provider.exchangeAuthorizationCode(command), expected);
    expect(idp.tokenRequests).toBe(1);
  },
);

test.each([
  ["issuer", () => ({ iss: "https://other.example.invalid" })],
  ["audience", () => ({ aud: "other-client" })],
  [
    "multiple audiences without azp",
    () => ({ aud: [clientId, "other-client"] }),
  ],
  [
    "multiple audiences wrong azp",
    () => ({ aud: [clientId, "other-client"], azp: "other-client" }),
  ],
  ["single audience wrong azp", () => ({ azp: "other-client" })],
  ["expired", () => ({ exp: Math.floor(Date.now() / 1000) - 1 })],
  ["future issued time", () => ({ iat: Math.floor(Date.now() / 1000) + 120 })],
  ["missing authentication time", () => ({ auth_time: undefined })],
  [
    "fractional authentication time",
    () => ({ auth_time: Date.now() / 1000 + 0.125 }),
  ],
  [
    "future authentication time",
    () => ({ auth_time: Math.floor(Date.now() / 1000) + 120 }),
  ],
  [
    "stale authentication",
    () => ({ auth_time: Math.floor(Date.now() / 1000) - 301 }),
  ],
] as const)("rejects invalid signed claims: %s", async (_name, patch) => {
  const { provider, command } = await flow();
  idp.setClaims(patch());
  expectFailure(
    await provider.exchangeAuthorizationCode(command),
    "INVALID_ID_TOKEN",
  );
});

test("nonce mismatch is normalized without returning claims", async () => {
  const { provider, command } = await flow();
  idp.setClaims({ nonce: "x".repeat(43) });
  expectFailure(
    await provider.exchangeAuthorizationCode(command),
    "NONCE_MISMATCH",
  );
});

test.each([
  { acr: "urn:other:mfa" },
  { amr: ["pwd"] },
  { acr: undefined },
  { amr: "otp" },
])("fails closed when explicit MFA evidence does not match", async (patch) => {
  const { provider, command } = await flow();
  idp.setClaims(patch);
  expectFailure(
    await provider.exchangeAuthorizationCode(command),
    "AUTHENTICATION_FAILED",
  );
});

test("ACR-only and AMR-only mappings are explicit alternatives at configuration time", async () => {
  for (const mfa of [
    { acceptedAcrValues: ["urn:example:mfa"], requiredAmrValues: [] },
    { acceptedAcrValues: [], requiredAmrValues: ["pwd", "otp"] },
  ]) {
    const { provider, command } = await flow({ mfa });
    expect((await provider.exchangeAuthorizationCode(command)).outcome).toBe(
      "SUCCESS",
    );
  }
});

test.each([
  ["DISCONNECT", "EXCHANGE_OUTCOME_UNKNOWN"],
  ["SLOW", "EXCHANGE_OUTCOME_UNKNOWN"],
  ["BODY_STALL", "EXCHANGE_OUTCOME_UNKNOWN"],
  ["OVERSIZED", "MALFORMED_PROVIDER_RESPONSE"],
  ["MALFORMED", "MALFORMED_PROVIDER_RESPONSE"],
  ["REDIRECT", "MALFORMED_PROVIDER_RESPONSE"],
  ["RATE_LIMIT", "EXCHANGE_OUTCOME_UNKNOWN"],
] as const)(
  "%s is bounded, sanitized and never retries the one-time exchange",
  async (selected, expected) => {
    const { provider, command } = await flow({
      requestTimeoutMs: 100,
      maxResponseBytes: 4096,
    });
    idp.setMode(selected);
    expectFailure(
      await provider.exchangeAuthorizationCode(command),
      expected,
      "RESTART_AUTHORIZATION",
    );
    expect(idp.tokenRequests).toBe(1);
  },
);

test("access denied is a safe fixed classification", async () => {
  const { provider, command } = await flow();
  idp.setMode("ACCESS_DENIED");
  expectFailure(
    await provider.exchangeAuthorizationCode(command),
    "ACCESS_DENIED",
  );
});

test.each([
  { issuer: "https://other.example.invalid" },
  { authorization_endpoint: "http://example.invalid/authorize" },
  { token_endpoint: "http://example.invalid/token" },
  { jwks_uri: "http://example.invalid/jwks" },
  { token_endpoint: "https://127.0.0.1/token" },
  { jwks_uri: "https://10.0.0.1/jwks" },
  { authorization_endpoint: "https://[::1]/authorize" },
  { jwks_uri: undefined },
  { code_challenge_methods_supported: ["plain"] },
])("rejects untrusted or incomplete discovery metadata", async (patch) => {
  idp.setDiscovery(patch);
  const provider = createOidcIdentityProvider(options(), { fetch: tlsFetch });
  expectFailure(
    await provider.createAuthorizationRequest(authorizationCommand()),
    "CONFIGURATION_ERROR",
  );
  expect(idp.tokenRequests).toBe(0);
});

test.each([
  { mfa: { acceptedAcrValues: [], requiredAmrValues: [] } },
  { redirectUri: `${redirectUri}?scope=other` },
  { issuer: "https://example.invalid/.well-known/openid-configuration" },
  { requestTimeoutMs: 0 },
  { maxResponseBytes: 2 },
  { maxAuthenticationAgeSeconds: 0 },
  { clockSkewSeconds: 31 },
])("rejects unsafe configuration before any network access", (patch) => {
  expect(() =>
    createOidcIdentityProvider(options(patch), { fetch: tlsFetch }),
  ).toThrow("Invalid OIDC configuration");
  expect(idp.discoveryRequests).toBe(0);
});

test("configuration is copied so later caller mutation cannot weaken MFA", async () => {
  const mapping = {
    acceptedAcrValues: ["urn:example:mfa"],
    requiredAmrValues: ["otp"],
  };
  const provider = createOidcIdentityProvider(options({ mfa: mapping }), {
    fetch: tlsFetch,
  });
  mapping.acceptedAcrValues.splice(0);
  mapping.requiredAmrValues.splice(0);
  const created = await provider.createAuthorizationRequest(
    authorizationCommand(),
  );
  expect(created.outcome).toBe("SUCCESS");
  if (created.outcome !== "SUCCESS")
    throw new Error("Authorization fixture failed");
  const response = await tlsFetch(created.value.authorizationUrl);
  const code = new URL(
    response.headers.get("location") ?? "https://invalid.example",
  ).searchParams.get("code");
  idp.setClaims({ amr: ["pwd"] });
  expectFailure(
    await provider.exchangeAuthorizationCode(
      identityPortCommandSchema.parse({
        schemaVersion: 1,
        operation: "EXCHANGE_AUTHORIZATION_CODE",
        issuer,
        clientId,
        redirectUri,
        code,
        state,
        expectedState: state,
        nonce,
        codeVerifier: verifier,
        receivedAt: new Date().toISOString(),
      }) as ExchangeAuthorizationCodeCommand,
    ),
    "AUTHENTICATION_FAILED",
  );
});

test("shared HTTPS fixture limits its DNS override and authorization redirect origins", async () => {
  await expect(idp.fetch("https://other.example.invalid/jwks")).rejects.toThrow(
    "Test OIDC transport origin mismatch",
  );
  const provider = createOidcIdentityProvider(options(), { fetch: tlsFetch });
  const created = await provider.createAuthorizationRequest(
    authorizationCommand(),
  );
  if (created.outcome !== "SUCCESS")
    throw new Error("Authorization fixture failed");
  const url = new URL(created.value.authorizationUrl);
  url.searchParams.set(
    "redirect_uri",
    "https://other.example.invalid/callback",
  );
  expect((await tlsFetch(url)).status).toBe(400);
  expect(idp.tokenRequests).toBe(0);
});

test("shared fixture switches pre-provisioned subjects and exposes explicit no-MFA mode", async () => {
  idp.setSubject("second-provisioned-subject");
  const { provider, command } = await flow();
  const result = await provider.exchangeAuthorizationCode(command);
  expect(result).toMatchObject({
    outcome: "SUCCESS",
    value: { principal: { subject: "second-provisioned-subject" } },
  });
  const next = await flow();
  idp.setMode("no-mfa");
  expectFailure(
    await next.provider.exchangeAuthorizationCode(next.command),
    "AUTHENTICATION_FAILED",
  );
});
