import { expect, test, vi } from "vitest";
import { createAdminAccessUseCases } from "../../../packages/application/src/admin-access.ts";
import { createCartRuntimeUseCases } from "../../../packages/application/src/cart-runtime.ts";

vi.mock("server-only", () => ({}));

const instant = new Date("2026-09-24T11:00:00.000Z");
const expiresAt = "2026-09-24T11:05:00.000Z";
const origin = "https://admin.example.invalid";
const issuer = "https://identity.example.invalid";

test("100 credential-free login requests at one fixed instant each reach challenge persistence", async () => {
  const challengeIds = new Set<string>();
  let persistenceWrites = 0;
  let providerRequests = 0;
  let codeExchanges = 0;
  const app = createAdminAccessUseCases({
    settings: {
      schemaVersion: 1,
      issuer,
      clientId: "audit-fixture-client",
      redirectUri: `${origin}/api/admin/auth/callback`,
      policyVersion: "v1",
      loginTtlSeconds: 300,
      sessionTtlSeconds: 3600,
      maxAuthenticationAgeSeconds: 300,
    },
    tokenPepper: "a".repeat(64),
    subjectPepper: "b".repeat(64),
    now: () => instant,
    identityProvider: {
      async createAuthorizationRequest(command) {
        providerRequests++;
        return {
          schemaVersion: 1,
          operation: "CREATE_AUTHORIZATION_REQUEST",
          outcome: "SUCCESS",
          value: {
            authorizationUrl: `${issuer}/authorize?state=${command.state}`,
            state: command.state,
            expiresAt,
          },
        };
      },
      async exchangeAuthorizationCode() {
        codeExchanges++;
        throw new Error("The unauthenticated proof must never exchange a code");
      },
    },
    transactions: {
      async runInAdminAccessTransaction(work) {
        return work({
          adminAccess: {
            async create(command: { challengeId: string }) {
              challengeIds.add(command.challengeId);
              persistenceWrites++;
              return {
                schemaVersion: 1,
                outcome: "SUCCESS",
                kind: "LOGIN_CREATED",
                expiresAt,
              };
            },
          },
        } as never);
      },
    },
  });
  const { createAdminAccessBff } =
    await import("../../../apps/admin/src/server/admin-access-bff.ts");
  const bff = createAdminAccessBff({
    config: {
      schemaVersion: 1,
      mode: "LOCAL_OIDC",
      siteOrigin: origin,
      internalApiOrigin: "http://127.0.0.1:3200",
      adminAccessKey: "c".repeat(64),
      oidcIssuer: issuer,
    },
    now: () => instant.getTime(),
    fetch: async (_url, init) =>
      Response.json(await app.begin(JSON.parse(String(init?.body)))),
  });
  for (let index = 0; index < 100; index++) {
    const response = await bff.begin(
      new Request(`${origin}/api/admin/auth/begin`, {
        method: "POST",
        headers: {
          origin,
          "sec-fetch-site": "same-origin",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "locale=en",
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.outcome).toBe("SUCCESS");
    expect(body).not.toHaveProperty("browserToken");
  }
  expect(persistenceWrites).toBe(100);
  expect(challengeIds.size).toBe(100);
  expect(providerRequests).toBe(100);
  expect(codeExchanges).toBe(0);
});

test("100 fresh cart credential requests at one fixed instant each reach cart persistence", async () => {
  const cartIds = new Set<string>();
  let persistenceWrites = 0;
  const app = createCartRuntimeUseCases({
    now: () => instant,
    keyManagement: {} as never,
    transactions: {
      async runInCartRuntimeTransaction(work) {
        return work({
          cartRuntime: {
            async findByCredentialForUpdate() {
              return null;
            },
            async initialize(command: { cartId: string; expiresAt: string }) {
              persistenceWrites++;
              cartIds.add(command.cartId);
              return {
                schemaVersion: 1,
                id: command.cartId,
                version: 1,
                status: "ACTIVE",
                expired: false,
                presentationLocale: "en",
                market: "TEST",
                currency: "USD",
                expiresAt: command.expiresAt,
                createdAt: instant.toISOString(),
                updatedAt: instant.toISOString(),
              };
            },
            async listItems() {
              return [];
            },
          },
        } as never);
      },
    },
  });
  for (let index = 0; index < 100; index++) {
    const result = await app.initialize(
      {
        schemaVersion: 1,
        operation: "INITIALIZE_CART",
        presentationLocale: "en",
        market: "TEST",
        currency: "USD",
      },
      {
        schemaVersion: 1,
        accesses: [
          {
            schemaVersion: 1,
            tokenDigest: (index + 1).toString(16).padStart(64, "0"),
            pepperVersion: "audit-test-v1",
          },
        ],
        requestId: "10000000-0000-4000-8000-000000000001",
        correlationId: "10000000-0000-4000-8000-000000000001",
      },
    );
    expect(result.outcome).toBe("SUCCESS");
  }
  expect(persistenceWrites).toBe(100);
  expect(cartIds.size).toBe(100);
});
