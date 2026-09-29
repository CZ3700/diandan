import { expect, test } from "vitest";
import { resolveAdminRuntimeConfig } from "./server-config.js";
const local = {
  NODE_ENV: "development",
  FAN_SUPPORT_DEPLOYMENT_ENV: "development",
  FAN_SUPPORT_SITE_ORIGIN: "http://localhost:3100",
  FAN_SUPPORT_INTERNAL_API_ORIGIN: "http://127.0.0.1:3200",
  FAN_SUPPORT_ADMIN_MODE: "TEST",
};
test("administration is closed by default and explicitly enabled only for local development", () => {
  expect(resolveAdminRuntimeConfig({ environment: {} })).toEqual({
    schemaVersion: 1,
    mode: "DISABLED",
  });
  expect(resolveAdminRuntimeConfig({ environment: local })).toEqual({
    schemaVersion: 1,
    mode: "TEST",
    siteOrigin: local.FAN_SUPPORT_SITE_ORIGIN,
    internalApiOrigin: local.FAN_SUPPORT_INTERNAL_API_ORIGIN,
  });
});
test("TEST administration rejects production tiers, remote targets, credentials and unknown modes", () => {
  for (const patch of [
    { NODE_ENV: "production", FAN_SUPPORT_DEPLOYMENT_ENV: "production" },
    { FAN_SUPPORT_SITE_ORIGIN: "https://example.com" },
    { FAN_SUPPORT_INTERNAL_API_ORIGIN: "https://api.example.com" },
    { FAN_SUPPORT_INTERNAL_API_ORIGIN: "http://secret@localhost:3200" },
    { FAN_SUPPORT_ADMIN_MODE: "production" },
  ])
    expect(() =>
      resolveAdminRuntimeConfig({ environment: { ...local, ...patch } }),
    ).toThrow();
});

test("the explicit management storefront link does not break Admin runtime configuration", () => {
  expect(
    resolveAdminRuntimeConfig({
      environment: {
        ...local,
        FAN_SUPPORT_STOREFRONT_ORIGIN: "http://localhost:3011",
      },
    }).mode,
  ).toBe("TEST");
});

test("local OIDC access requires HTTPS, an internal secret, explicit issuer and development tier", () => {
  const oidc = {
    ...local,
    FAN_SUPPORT_ADMIN_MODE: "LOCAL_OIDC",
    FAN_SUPPORT_SITE_ORIGIN: "https://admin.example.invalid",
    FAN_SUPPORT_ADMIN_ACCESS_KEY: "a".repeat(64),
    FAN_SUPPORT_ADMIN_OIDC_ISSUER: "https://identity.example.invalid",
  };
  expect(resolveAdminRuntimeConfig({ environment: oidc })).toEqual({
    schemaVersion: 1,
    mode: "LOCAL_OIDC",
    siteOrigin: oidc.FAN_SUPPORT_SITE_ORIGIN,
    internalApiOrigin: local.FAN_SUPPORT_INTERNAL_API_ORIGIN,
    adminAccessKey: oidc.FAN_SUPPORT_ADMIN_ACCESS_KEY,
    oidcIssuer: oidc.FAN_SUPPORT_ADMIN_OIDC_ISSUER,
  });
  for (const patch of [
    { FAN_SUPPORT_ADMIN_ACCESS_KEY: "" },
    { FAN_SUPPORT_ADMIN_OIDC_ISSUER: "http://identity.example.invalid" },
    { FAN_SUPPORT_ADMIN_OIDC_ISSUER: "https://identity.example.invalid?x=y" },
    { FAN_SUPPORT_SITE_ORIGIN: "http://localhost:3100" },
    { FAN_SUPPORT_INTERNAL_API_ORIGIN: "https://api.example.invalid" },
    { NODE_ENV: "production", FAN_SUPPORT_DEPLOYMENT_ENV: "production" },
  ])
    expect(() =>
      resolveAdminRuntimeConfig({ environment: { ...oidc, ...patch } }),
    ).toThrow();
});

const deployed = {
  NODE_ENV: "production",
  FAN_SUPPORT_DEPLOYMENT_ENV: "production",
  FAN_SUPPORT_SITE_ORIGIN: "https://admin.example.invalid",
  FAN_SUPPORT_INTERNAL_API_ORIGIN: "https://api.example.invalid",
  FAN_SUPPORT_ADMIN_MODE: "OIDC",
  FAN_SUPPORT_ADMIN_ACCESS_KEY: "b".repeat(64),
  FAN_SUPPORT_ADMIN_OIDC_ISSUER:
    "https://identity.example.invalid/realm/studio",
};

test.each(["staging", "production"])(
  "explicit OIDC supports a production build in %s with only server-side credentials",
  (tier) => {
    const config = resolveAdminRuntimeConfig({
      environment: { ...deployed, FAN_SUPPORT_DEPLOYMENT_ENV: tier },
    });
    expect(config).toEqual({
      schemaVersion: 1,
      mode: "OIDC",
      siteOrigin: deployed.FAN_SUPPORT_SITE_ORIGIN,
      internalApiOrigin: deployed.FAN_SUPPORT_INTERNAL_API_ORIGIN,
      adminAccessKey: deployed.FAN_SUPPORT_ADMIN_ACCESS_KEY,
      oidcIssuer: deployed.FAN_SUPPORT_ADMIN_OIDC_ISSUER,
    });
    expect(Object.isFrozen(config)).toBe(true);
  },
);

test("OIDC does not relax development modes, TLS, canonical URLs or required credentials", () => {
  for (const patch of [
    { FAN_SUPPORT_ADMIN_MODE: "LOCAL_OIDC" },
    { FAN_SUPPORT_ADMIN_MODE: "TEST" },
    { NODE_ENV: "development" },
    { FAN_SUPPORT_DEPLOYMENT_ENV: "preview" },
    { NODE_ENV: "development", FAN_SUPPORT_DEPLOYMENT_ENV: "development" },
    { NODE_ENV: "test", FAN_SUPPORT_DEPLOYMENT_ENV: "test" },
    { FAN_SUPPORT_SITE_ORIGIN: "http://localhost:3100" },
    { FAN_SUPPORT_SITE_ORIGIN: "https://admin.example.invalid/path" },
    { FAN_SUPPORT_INTERNAL_API_ORIGIN: "http://127.0.0.1:3200" },
    { FAN_SUPPORT_INTERNAL_API_ORIGIN: "https://localhost:3200" },
    { FAN_SUPPORT_INTERNAL_API_ORIGIN: "https://api.example.invalid/path" },
    { FAN_SUPPORT_INTERNAL_API_ORIGIN: "https://user@api.example.invalid" },
    { FAN_SUPPORT_ADMIN_ACCESS_KEY: undefined },
    { FAN_SUPPORT_ADMIN_ACCESS_KEY: "" },
    { FAN_SUPPORT_ADMIN_ACCESS_KEY: "not-an-access-key" },
    { FAN_SUPPORT_ADMIN_OIDC_ISSUER: undefined },
    { FAN_SUPPORT_ADMIN_OIDC_ISSUER: "http://identity.example.invalid" },
    { FAN_SUPPORT_ADMIN_OIDC_ISSUER: "https://identity.example.invalid?x=y" },
  ]) {
    expect(() =>
      resolveAdminRuntimeConfig({ environment: { ...deployed, ...patch } }),
    ).toThrow();
  }
});

test("OIDC preserves configuration precedence and never includes credentials in errors", () => {
  const valid = resolveAdminRuntimeConfig({
    configFile: { ...deployed, FAN_SUPPORT_ADMIN_MODE: "DISABLED" },
    environment: { FAN_SUPPORT_ADMIN_MODE: "OIDC" },
  });
  expect(valid.mode).toBe("OIDC");
  const secret = "sensitive-credential-canary";
  try {
    resolveAdminRuntimeConfig({
      environment: { ...deployed, FAN_SUPPORT_ADMIN_ACCESS_KEY: secret },
    });
    expect.fail("Invalid credentials must fail closed");
  } catch (error) {
    expect(String(error)).toContain("FAN_SUPPORT_ADMIN_ACCESS_KEY");
    expect(String(error)).not.toContain(secret);
  }
  expect(
    resolveAdminRuntimeConfig({
      environment: {
        ...deployed,
        FAN_SUPPORT_ADMIN_MODE: "DISABLED",
      },
    }),
  ).toEqual({ schemaVersion: 1, mode: "DISABLED" });
});

// ADR-021: built-in accounts. Formal tiers check like OIDC; the remote TEST instance checks like LOCAL_OIDC.
test.each([
  ["a formal staging or production build", { ...deployed }],
  [
    "the remote TEST instance in development mode",
    {
      ...local,
      FAN_SUPPORT_SITE_ORIGIN: "https://admin.stg.example.invalid",
      FAN_SUPPORT_ADMIN_ACCESS_KEY: "b".repeat(64),
    },
  ],
])("built-in accounts run in %s without an identity provider", (_, base) => {
  const environment = {
    ...base,
    FAN_SUPPORT_ADMIN_MODE: "LOCAL_ACCOUNT",
    FAN_SUPPORT_ADMIN_OIDC_ISSUER: undefined,
  };
  const config = resolveAdminRuntimeConfig({ environment });
  expect(config).toEqual({
    schemaVersion: 1,
    mode: "LOCAL_ACCOUNT",
    siteOrigin: environment.FAN_SUPPORT_SITE_ORIGIN,
    internalApiOrigin: environment.FAN_SUPPORT_INTERNAL_API_ORIGIN,
    adminAccessKey: "b".repeat(64),
  });
  expect(Object.isFrozen(config)).toBe(true);
});

test("built-in accounts keep TLS, canonical origins and the internal secret", () => {
  const account = { ...deployed, FAN_SUPPORT_ADMIN_MODE: "LOCAL_ACCOUNT" };
  for (const patch of [
    { FAN_SUPPORT_ADMIN_ACCESS_KEY: undefined },
    { FAN_SUPPORT_ADMIN_ACCESS_KEY: "not-an-access-key" },
    { FAN_SUPPORT_SITE_ORIGIN: "http://admin.example.invalid" },
    { FAN_SUPPORT_SITE_ORIGIN: "https://admin.example.invalid/path" },
    { FAN_SUPPORT_INTERNAL_API_ORIGIN: "http://127.0.0.1:3200" },
    { NODE_ENV: "development" },
    { FAN_SUPPORT_DEPLOYMENT_ENV: "preview" },
    { NODE_ENV: "test", FAN_SUPPORT_DEPLOYMENT_ENV: "test" },
    // Development mode needs a public HTTPS site and a loopback API.
    { NODE_ENV: "development", FAN_SUPPORT_DEPLOYMENT_ENV: "development" },
    {
      NODE_ENV: "development",
      FAN_SUPPORT_DEPLOYMENT_ENV: "development",
      FAN_SUPPORT_INTERNAL_API_ORIGIN: "http://127.0.0.1:3200",
      FAN_SUPPORT_SITE_ORIGIN: "http://localhost:3100",
    },
  ])
    expect(() =>
      resolveAdminRuntimeConfig({ environment: { ...account, ...patch } }),
    ).toThrow();
});
