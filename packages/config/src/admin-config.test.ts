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
