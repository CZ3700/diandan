import { expect, test } from "vitest";

import { resolveApiProductionConfig } from "./production-config.js";
import {
  adminEnvironment,
  commerceEnvironment,
  completeProductionEnvironment,
  coreEnvironment,
  paymentEnvironment,
} from "./test-support/production-environment.js";

test("core-only configuration deploys the public surface and nothing optional", () => {
  expect(resolveApiProductionConfig(coreEnvironment)).toMatchObject({
    siteOrigin: "https://shop.example.invalid",
    databaseUrl: coreEnvironment.FAN_SUPPORT_DATABASE_URL,
    storage: { publicMediaOrigin: "https://media.example.invalid" },
    keyManagement: undefined,
    orderAccess: undefined,
    payment: { runtime: undefined, connections: [], healthPolicies: [] },
    admin: undefined,
  });
});

test("a complete configuration resolves every surface once", () => {
  const config = resolveApiProductionConfig(completeProductionEnvironment);
  expect(config.keyManagement?.activeBlindIndexKeyVersion).toBe("blind-v1");
  expect(config.orderAccess?.publicStorefrontOrigin).toBe(config.siteOrigin);
  expect(config.payment.runtime?.publicStorefrontOrigin).toBe(
    config.siteOrigin,
  );
  expect(config.admin?.allowedOrigin).toBe("https://admin.example.invalid");
  expect(Object.isFrozen(config)).toBe(true);
});

test("surfaces that encrypt or authenticate refuse to start without key management", () => {
  const orderAccess = {
    FAN_SUPPORT_ORDER_ACCESS_CONFIG_JSON:
      commerceEnvironment.FAN_SUPPORT_ORDER_ACCESS_CONFIG_JSON,
  };
  for (const [patch, message] of [
    [adminEnvironment, "Administration requires key management"],
    [orderAccess, "Order access requires key management"],
    [paymentEnvironment, "Payment requires key management"],
  ] as const)
    expect(() =>
      resolveApiProductionConfig({ ...coreEnvironment, ...patch }),
    ).toThrow(message);
});

test("unknown or retired deployment keys fail before any surface is considered", () => {
  expect(() =>
    resolveApiProductionConfig({
      ...coreEnvironment,
      FAN_SUPPORT_PAYMENT_PROVIDER_BINDINGS_JSON: "[]",
    }),
  ).toThrow("Runtime configuration is invalid");
});
