import { expect, test, vi } from "vitest";
import {
  createLocalAccountAdminAccessComposition,
  createLocalOidcAdminAccessComposition,
} from "./admin-access-composition.js";
const settings = {
  schemaVersion: 1 as const,
  issuer: "https://identity.example.invalid",
  clientId: "admin",
  redirectUri: "https://admin.example.invalid/api/admin/auth/callback",
  policyVersion: "v1",
  loginTtlSeconds: 300,
  sessionTtlSeconds: 3600,
  maxAuthenticationAgeSeconds: 300,
};
const options = {
  environment: "LOCAL_OIDC" as const,
  database: {
    schemaVersion: 1 as const,
    connectionString: "postgresql://fixture@localhost/fixture",
    maxConnections: 2,
  },
  settings,
  tokenPepper: "a".repeat(64),
  subjectPepper: "b".repeat(64),
  accessKey: "c".repeat(64),
  allowedOrigin: "https://admin.example.invalid",
  provider: {
    ...settings,
    clientAuthentication: { method: "NONE" as const },
    mfa: { acceptedAcrValues: ["urn:fixture:mfa"], requiredAmrValues: [] },
  },
};
test("local identity composition owns persistence lifetime and creates access and session use cases", async () => {
  const close = vi.fn(async () => undefined);
  const createPersistence = vi.fn(() => ({
    close,
    adminAccessTransactionManager: { runInAdminAccessTransaction: vi.fn() },
    adminSessionTransactionManager: { runInAdminSessionTransaction: vi.fn() },
  }));
  const c = createLocalOidcAdminAccessComposition(
    options as never,
    { createPersistence } as never,
  );
  expect(typeof c.adminAccessRoute.useCases.begin).toBe("function");
  expect(typeof c.adminSessionRoute.useCases.execute).toBe("function");
  await c.adminAccessRuntime.start();
  await Promise.all([c.adminAccessRuntime.stop(), c.adminAccessRuntime.stop()]);
  expect(close).toHaveBeenCalledTimes(1);
});
test("configuration mismatches and nonlocal tiers fail before opening the database", () => {
  const createPersistence = vi.fn();
  for (const update of [
    { environment: "PRODUCTION" },
    { allowedOrigin: "http://localhost:3000" },
    {
      settings: {
        ...settings,
        redirectUri: "https://other.example.invalid/callback",
      },
    },
    {
      provider: {
        ...options.provider,
        issuer: "https://other.example.invalid",
      },
    },
    { accessKey: "invalid" },
  ])
    expect(() =>
      createLocalOidcAdminAccessComposition(
        { ...options, ...update } as never,
        { createPersistence },
      ),
    ).toThrow();
  expect(createPersistence).not.toHaveBeenCalled();
});

test("built-in accounts compose sign-in and account routes over one closable pool", async () => {
  const close = vi.fn(async () => undefined);
  const local = {
    environment: "LOCAL_ACCOUNT" as const,
    database: options.database,
    keyManagement: { encryptEnvelope: vi.fn(), decryptEnvelope: vi.fn() },
    tokenPepper: options.tokenPepper,
    subjectPepper: options.subjectPepper,
    accessKey: options.accessKey,
    allowedOrigin: options.allowedOrigin,
  };
  const composition = createLocalAccountAdminAccessComposition(local as never, {
    createPersistence: () =>
      ({
        adminLocalAccessTransactionManager: {
          runInAdminLocalAccessTransaction: vi.fn(),
        },
        close,
      }) as never,
  });
  expect(composition.adminLocalAccessRoute.allowedOrigin).toBe(
    options.allowedOrigin,
  );
  expect(typeof composition.adminLocalAccessRoute.useCases.login).toBe(
    "function",
  );
  expect(typeof composition.adminAccountRoute.useCases.staff).toBe("function");
  await composition.adminLocalAccessRuntime.stop();
  await composition.adminLocalAccessRuntime.stop();
  expect(close).toHaveBeenCalledTimes(1);
  for (const patch of [
    { environment: "LOCAL_OIDC" },
    { allowedOrigin: "http://admin.example.invalid" },
    { tokenPepper: options.subjectPepper },
    { accessKey: "short" },
  ])
    expect(() =>
      createLocalAccountAdminAccessComposition(
        { ...local, ...patch } as never,
        {
          createPersistence: () => ({ close }) as never,
        },
      ),
    ).toThrow("Invalid local account admin access configuration");
});
