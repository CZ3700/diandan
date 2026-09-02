import { beforeEach, expect, test, vi } from "vitest";

const { loadAdminRuntimeConfig } = vi.hoisted(() => ({
  loadAdminRuntimeConfig: vi.fn(),
}));

vi.mock("../../server/runtime-config", () => ({
  loadAdminRuntimeConfig,
}));

import { GET } from "./route";

beforeEach(() => {
  loadAdminRuntimeConfig.mockReset();
});

test("validates runtime config before reporting admin health", async () => {
  const response = GET();

  expect(loadAdminRuntimeConfig).toHaveBeenCalledOnce();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  await expect(response.json()).resolves.toEqual({
    schemaVersion: 1,
    service: "admin",
    status: "ok",
  });
});

test("does not report admin health when runtime config is invalid", () => {
  const configError = new Error("invalid runtime config");
  loadAdminRuntimeConfig.mockImplementationOnce(() => {
    throw configError;
  });

  expect(() => GET()).toThrow(configError);
});
