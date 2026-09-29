import { expect, it } from "vitest";
import { resolveConfigLayers } from "./config-layers.js";

it("recognizes explicit server health bootstrap policy without tolerating a misspelled key", () => {
  const key = "FAN_SUPPORT_PAYMENT_HEALTH_POLICIES_JSON";
  expect(resolveConfigLayers({ environment: { [key]: "[]" } }, [key])).toEqual({
    [key]: "[]",
  });
  expect(() =>
    resolveConfigLayers(
      { environment: { FAN_SUPPORT_PAYMENT_HEALTH_POLICES_JSON: "[]" } },
      [],
    ),
  ).toThrow();
});

it("accepts declared server payment metadata while retaining environment precedence", () => {
  const key = "FAN_SUPPORT_PAYMENT_RUNTIME_CONFIG_JSON";
  const sources = {
    configFile: { [key]: "file" },
    environment: {
      [key]: "environment",
      FAN_SUPPORT_PAYMENT_ACCOUNT_CONNECTIONS_JSON: "[]",
      FAN_SUPPORT_PAYMENT_ACTION_ORIGINS_JSON: "[]",
    },
  };
  expect(resolveConfigLayers(sources, [key])).toEqual({ [key]: "environment" });
});

it("rejects the retired static provider binding key so stale deployments fail at startup", () => {
  expect(() =>
    resolveConfigLayers(
      { environment: { FAN_SUPPORT_PAYMENT_PROVIDER_BINDINGS_JSON: "[]" } },
      [],
    ),
  ).toThrow();
});

it("recognizes the production administration keys", () => {
  const environment = {
    FAN_SUPPORT_ADMIN_ORIGIN: "origin",
    FAN_SUPPORT_ADMIN_TOKEN_PEPPER: "token",
    FAN_SUPPORT_ADMIN_SUBJECT_PEPPER: "subject",
    FAN_SUPPORT_ADMIN_OIDC_CONFIG_JSON: "config",
    FAN_SUPPORT_ADMIN_OIDC_CLIENT_SECRET: "secret",
    FAN_SUPPORT_ADMIN_LOCAL_ACCOUNTS: "ENABLED",
    FAN_SUPPORT_ADMIN_TOTP_ISSUER: "Studio Admin",
  };
  expect(
    resolveConfigLayers({ environment }, ["FAN_SUPPORT_ADMIN_ORIGIN"]),
  ).toEqual({ FAN_SUPPORT_ADMIN_ORIGIN: "origin" });
});

it("recognizes notification and order access server metadata without permitting misspelled keys", () => {
  const key = "FAN_SUPPORT_NOTIFICATION_CONFIG_JSON";
  expect(
    resolveConfigLayers(
      {
        environment: {
          [key]: "metadata",
          FAN_SUPPORT_ORDER_ACCESS_CONFIG_JSON: "access",
          MAIL_GATEWAY_CREDENTIAL: "private",
        },
      },
      [key],
    ),
  ).toEqual({ [key]: "metadata" });
  expect(() =>
    resolveConfigLayers(
      { environment: { FAN_SUPPORT_NOTIFICATON_CONFIG_JSON: "typo" } },
      [],
    ),
  ).toThrow();
});
