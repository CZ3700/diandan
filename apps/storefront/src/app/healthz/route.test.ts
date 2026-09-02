import { beforeEach, expect, test, vi } from "vitest";

const { loadStorefrontRuntimeConfig } = vi.hoisted(() => ({
  loadStorefrontRuntimeConfig: vi.fn(),
}));

vi.mock("../../server/runtime-config", () => ({
  loadStorefrontRuntimeConfig,
}));

import { GET } from "./route";

beforeEach(() => {
  loadStorefrontRuntimeConfig.mockReset();
});

test("validates runtime config before reporting storefront health", async () => {
  const response = GET();

  expect(loadStorefrontRuntimeConfig).toHaveBeenCalledOnce();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  await expect(response.json()).resolves.toEqual({
    schemaVersion: 1,
    service: "storefront",
    status: "ok",
  });
});

test("does not report storefront health when runtime config is invalid", () => {
  const configError = new Error("invalid runtime config");
  loadStorefrontRuntimeConfig.mockImplementationOnce(() => {
    throw configError;
  });

  expect(() => GET()).toThrow(configError);
});
