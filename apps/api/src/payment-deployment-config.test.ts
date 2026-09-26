import { expect, test } from "vitest";

import { resolvePaymentDeploymentConfig } from "./payment-deployment-config.js";
import {
  paymentConnection,
  paymentEnvironment,
  paymentHealthPolicy,
} from "./test-support/production-environment.js";

const siteOrigin = "https://shop.example.invalid";
const deployed = {
  ...paymentEnvironment,
  FAN_SUPPORT_PAYMENT_ACCOUNT_CONNECTIONS_JSON: JSON.stringify([
    paymentConnection,
  ]),
  FAN_SUPPORT_PAYMENT_HEALTH_POLICIES_JSON: JSON.stringify([
    paymentHealthPolicy,
  ]),
};

test("absent payment metadata deploys no account and keeps checkout payment unavailable", () => {
  expect(resolvePaymentDeploymentConfig({}, siteOrigin)).toEqual({
    runtime: undefined,
    connections: [],
    healthPolicies: [],
  });
});

test("deployed accounts carry exactly one explicit health policy each", () => {
  const config = resolvePaymentDeploymentConfig(deployed, siteOrigin);
  expect(config.runtime?.publicStorefrontOrigin).toBe(siteOrigin);
  expect(config.connections).toEqual([paymentConnection]);
  expect(config.healthPolicies).toEqual([paymentHealthPolicy]);
});

test("partial, duplicate or unbounded payment metadata is rejected before any resource opens", () => {
  const otherAccount = {
    ...paymentHealthPolicy,
    providerAccountId: "10000000-0000-4000-8000-000000000009",
  };
  for (const patch of [
    { FAN_SUPPORT_PAYMENT_RUNTIME_CONFIG_JSON: "{}" },
    { FAN_SUPPORT_PAYMENT_RUNTIME_CONFIG_JSON: "not-json" },
    { FAN_SUPPORT_PAYMENT_HEALTH_POLICIES_JSON: undefined },
    { FAN_SUPPORT_PAYMENT_HEALTH_POLICIES_JSON: "[]" },
    { FAN_SUPPORT_PAYMENT_ACCOUNT_CONNECTIONS_JSON: undefined },
    { FAN_SUPPORT_PAYMENT_ACCOUNT_CONNECTIONS_JSON: "{}" },
    {
      FAN_SUPPORT_PAYMENT_HEALTH_POLICIES_JSON: JSON.stringify([
        paymentHealthPolicy,
        paymentHealthPolicy,
      ]),
    },
    {
      FAN_SUPPORT_PAYMENT_HEALTH_POLICIES_JSON: JSON.stringify([otherAccount]),
    },
    {
      FAN_SUPPORT_PAYMENT_ACCOUNT_CONNECTIONS_JSON: JSON.stringify([
        paymentConnection,
        paymentConnection,
      ]),
    },
    {
      FAN_SUPPORT_PAYMENT_ACCOUNT_CONNECTIONS_JSON: JSON.stringify(
        Array.from({ length: 101 }, () => paymentConnection),
      ),
    },
  ])
    expect(() =>
      resolvePaymentDeploymentConfig({ ...deployed, ...patch }, siteOrigin),
    ).toThrow("Invalid payment runtime configuration");
});

test("runtime and account return origins must be the deployment's storefront", () => {
  expect(() =>
    resolvePaymentDeploymentConfig(deployed, "https://other.example.invalid"),
  ).toThrow("Payment storefront origin does not match deployment");
  expect(() =>
    resolvePaymentDeploymentConfig(
      {
        FAN_SUPPORT_PAYMENT_ACCOUNT_CONNECTIONS_JSON: JSON.stringify([
          {
            ...paymentConnection,
            returnOrigin: "https://other.example.invalid",
          },
        ]),
        FAN_SUPPORT_PAYMENT_HEALTH_POLICIES_JSON: JSON.stringify([
          paymentHealthPolicy,
        ]),
      },
      siteOrigin,
    ),
  ).toThrow("Payment storefront origin does not match deployment");
});
