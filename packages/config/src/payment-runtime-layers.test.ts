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
      FAN_SUPPORT_PAYMENT_PROVIDER_BINDINGS_JSON: "[]",
      FAN_SUPPORT_PAYMENT_ACTION_ORIGINS_JSON: "[]",
    },
  };
  expect(resolveConfigLayers(sources, [key])).toEqual({ [key]: "environment" });
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
