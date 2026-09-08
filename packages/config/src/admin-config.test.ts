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
