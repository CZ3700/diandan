import { expect, test } from "vitest";

import { resolveAdminApiRuntimeConfig } from "./admin-runtime-config.js";
import {
  adminEnvironment,
  adminOidcConfiguration,
} from "./test-support/production-environment.js";

const clientSecret = "confidential-client-credential";

test("an absent administration surface, or only the Admin app's shared keys, stays undeployed", () => {
  expect(resolveAdminApiRuntimeConfig({})).toBeUndefined();
  expect(
    resolveAdminApiRuntimeConfig({
      FAN_SUPPORT_ADMIN_ACCESS_KEY:
        adminEnvironment.FAN_SUPPORT_ADMIN_ACCESS_KEY,
      FAN_SUPPORT_ADMIN_OIDC_ISSUER:
        adminEnvironment.FAN_SUPPORT_ADMIN_OIDC_ISSUER,
    }),
  ).toBeUndefined();
});

test("a complete configuration derives the callback and binds MFA and client authentication", () => {
  expect(resolveAdminApiRuntimeConfig(adminEnvironment)).toEqual({
    allowedOrigin: "https://admin.example.invalid",
    accessKey: "1".repeat(64),
    tokenPepper: "2".repeat(64),
    subjectPepper: "3".repeat(64),
    settings: {
      schemaVersion: 1,
      issuer: "https://identity.example.invalid",
      clientId: "fan-support-admin",
      redirectUri: "https://admin.example.invalid/api/admin/auth/callback",
      policyVersion: "admin-mfa-v1",
      loginTtlSeconds: 300,
      sessionTtlSeconds: 3600,
      maxAuthenticationAgeSeconds: 300,
    },
    provider: {
      issuer: "https://identity.example.invalid",
      clientId: "fan-support-admin",
      redirectUri: "https://admin.example.invalid/api/admin/auth/callback",
      clientAuthentication: { method: "NONE" },
      mfa: { acceptedAcrValues: [], requiredAmrValues: ["mfa"] },
      maxAuthenticationAgeSeconds: 300,
    },
  });
  const confidential = resolveAdminApiRuntimeConfig({
    ...adminEnvironment,
    FAN_SUPPORT_ADMIN_OIDC_CONFIG_JSON: JSON.stringify({
      ...adminOidcConfiguration,
      clientAuthentication: "CLIENT_SECRET_BASIC",
    }),
    FAN_SUPPORT_ADMIN_OIDC_CLIENT_SECRET: clientSecret,
  });
  expect(confidential?.provider.clientAuthentication).toEqual({
    method: "CLIENT_SECRET_BASIC",
    secret: clientSecret,
  });
});

test("partial, unsafe or inconsistent administration settings stop startup without echoing secrets", () => {
  const oidc = (patch: Readonly<Record<string, unknown>>) =>
    JSON.stringify({ ...adminOidcConfiguration, ...patch });
  for (const patch of [
    { FAN_SUPPORT_ADMIN_ACCESS_KEY: undefined },
    { FAN_SUPPORT_ADMIN_OIDC_ISSUER: undefined },
    { FAN_SUPPORT_ADMIN_SUBJECT_PEPPER: undefined },
    { FAN_SUPPORT_ADMIN_ORIGIN: "http://admin.example.invalid" },
    { FAN_SUPPORT_ADMIN_ORIGIN: "https://admin.example.invalid/console" },
    { FAN_SUPPORT_ADMIN_TOKEN_PEPPER: "A".repeat(64) },
    { FAN_SUPPORT_ADMIN_SUBJECT_PEPPER: "2".repeat(64) },
    { FAN_SUPPORT_ADMIN_ACCESS_KEY: "2".repeat(64) },
    { FAN_SUPPORT_ADMIN_OIDC_CONFIG_JSON: "not-json" },
    { FAN_SUPPORT_ADMIN_OIDC_CONFIG_JSON: oidc({ requiredAmrValues: [] }) },
    { FAN_SUPPORT_ADMIN_OIDC_CONFIG_JSON: oidc({ sessionTtlSeconds: 1 }) },
    { FAN_SUPPORT_ADMIN_OIDC_CONFIG_JSON: oidc({ extra: true }) },
    { FAN_SUPPORT_ADMIN_OIDC_CLIENT_SECRET: clientSecret },
    {
      FAN_SUPPORT_ADMIN_OIDC_CONFIG_JSON: oidc({
        clientAuthentication: "CLIENT_SECRET_BASIC",
      }),
    },
    {
      FAN_SUPPORT_ADMIN_OIDC_CONFIG_JSON: oidc({
        clientAuthentication: "CLIENT_SECRET_BASIC",
      }),
      FAN_SUPPORT_ADMIN_OIDC_CLIENT_SECRET: "short",
    },
  ]) {
    let message = "";
    try {
      resolveAdminApiRuntimeConfig({ ...adminEnvironment, ...patch });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toBe("Invalid admin runtime configuration");
  }
});
