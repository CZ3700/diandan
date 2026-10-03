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
    ledgerTimeZone: "Asia/Shanghai",
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
  expect(confidential?.provider?.clientAuthentication).toEqual({
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

test("built-in accounts can run with or without OIDC and default the authenticator label", () => {
  const withoutOidc = { ...adminEnvironment };
  delete (withoutOidc as Record<string, string | undefined>)[
    "FAN_SUPPORT_ADMIN_OIDC_CONFIG_JSON"
  ];
  delete (withoutOidc as Record<string, string | undefined>)[
    "FAN_SUPPORT_ADMIN_OIDC_ISSUER"
  ];
  expect(
    resolveAdminApiRuntimeConfig({
      ...withoutOidc,
      FAN_SUPPORT_ADMIN_LOCAL_ACCOUNTS: "ENABLED",
    }),
  ).toEqual({
    allowedOrigin: "https://admin.example.invalid",
    accessKey: "1".repeat(64),
    tokenPepper: "2".repeat(64),
    subjectPepper: "3".repeat(64),
    ledgerTimeZone: "Asia/Shanghai",
    localAccounts: { totpIssuer: "Studio Admin" },
  });
  const both = resolveAdminApiRuntimeConfig({
    ...adminEnvironment,
    FAN_SUPPORT_ADMIN_LOCAL_ACCOUNTS: "ENABLED",
    FAN_SUPPORT_ADMIN_TOTP_ISSUER: "Kiki Studio",
  });
  expect(both?.localAccounts).toEqual({ totpIssuer: "Kiki Studio" });
  expect(both?.settings?.issuer).toBe("https://identity.example.invalid");
  expect(resolveAdminApiRuntimeConfig(adminEnvironment)?.localAccounts).toBe(
    undefined,
  );
  // A label without the switch is a partial configuration, even beside OIDC.
  expect(() =>
    resolveAdminApiRuntimeConfig({
      ...adminEnvironment,
      FAN_SUPPORT_ADMIN_TOTP_ISSUER: "Kiki Studio",
    }),
  ).toThrow("Invalid admin runtime configuration");
});

test("built-in account switches accept only exact, safe values", () => {
  const withoutOidc = { ...adminEnvironment } as Record<
    string,
    string | undefined
  >;
  delete withoutOidc["FAN_SUPPORT_ADMIN_OIDC_CONFIG_JSON"];
  for (const patch of [
    { FAN_SUPPORT_ADMIN_LOCAL_ACCOUNTS: "enabled" },
    { FAN_SUPPORT_ADMIN_LOCAL_ACCOUNTS: "true" },
    { FAN_SUPPORT_ADMIN_TOTP_ISSUER: "Kiki Studio" },
    {
      FAN_SUPPORT_ADMIN_LOCAL_ACCOUNTS: "ENABLED",
      FAN_SUPPORT_ADMIN_TOTP_ISSUER: "Kiki:Studio",
    },
    {
      FAN_SUPPORT_ADMIN_LOCAL_ACCOUNTS: "ENABLED",
      FAN_SUPPORT_ADMIN_TOTP_ISSUER: "x".repeat(65),
    },
    {
      FAN_SUPPORT_ADMIN_LOCAL_ACCOUNTS: "ENABLED",
      FAN_SUPPORT_ADMIN_OIDC_CLIENT_SECRET: clientSecret,
    },
  ]) {
    let message = "";
    try {
      resolveAdminApiRuntimeConfig({ ...withoutOidc, ...patch });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toBe("Invalid admin runtime configuration");
  }
});

test("the artist ledger reports Beijing days unless the deployment names another real zone", () => {
  expect(resolveAdminApiRuntimeConfig(adminEnvironment)?.ledgerTimeZone).toBe(
    "Asia/Shanghai",
  );
  expect(
    resolveAdminApiRuntimeConfig({
      ...adminEnvironment,
      FAN_SUPPORT_LEDGER_TIME_ZONE: "UTC",
    })?.ledgerTimeZone,
  ).toBe("UTC");
  for (const zone of ["Mars/Olympus", "+08:00", ""])
    expect(() =>
      resolveAdminApiRuntimeConfig({
        ...adminEnvironment,
        FAN_SUPPORT_LEDGER_TIME_ZONE: zone,
      }),
    ).toThrow(TypeError);
});
