import { expect, test } from "vitest";
import * as server from "./server-config.js";
test("local environments explicitly report unconfigured purge while production requires a provider", () => {
  expect(
    server.resolveCachePurgeRuntimeConfig({
      environment: { FAN_SUPPORT_DEPLOYMENT_ENV: "test" },
    }),
  ).toEqual({ schemaVersion: 1, provider: "UNCONFIGURED" });
  for (const tier of ["staging", "production"])
    expect(() =>
      server.resolveCachePurgeRuntimeConfig({
        environment: { FAN_SUPPORT_DEPLOYMENT_ENV: tier },
      }),
    ).toThrow("FAN_SUPPORT_CACHE_PURGE_PROVIDER");
});
test("CloudFront identifiers come only from validated server configuration", () => {
  const environment = {
    FAN_SUPPORT_DEPLOYMENT_ENV: "production",
    FAN_SUPPORT_CACHE_PURGE_PROVIDER: "cloudfront",
    FAN_SUPPORT_CACHE_PURGE_REGION: "us-east-1",
    FAN_SUPPORT_CACHE_PURGE_DISTRIBUTION_ID: "E1FIXTURE",
  };
  expect(server.resolveCachePurgeRuntimeConfig({ environment })).toEqual({
    schemaVersion: 1,
    provider: "CLOUDFRONT",
    region: "us-east-1",
    distributionId: "E1FIXTURE",
  });
  for (const extra of [
    { FAN_SUPPORT_CACHE_PURGE_DISTRIBUTION_ID: "private value" },
    { FAN_SUPPORT_CACHE_PURGE_REGION: "" },
    { FAN_SUPPORT_CACHE_PURGE_PROVIDER: "noop" },
  ])
    expect(() =>
      server.resolveCachePurgeRuntimeConfig({
        environment: { ...environment, ...extra },
      }),
    ).toThrow();
});
