import { beforeEach, expect, test, vi } from "vitest";

import { isCanonicalRequestId } from "@fan-support/observability";

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
  const response = await GET(
    new Request("https://storefront.example.invalid/healthz"),
  );

  expect(loadStorefrontRuntimeConfig).toHaveBeenCalledOnce();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(isCanonicalRequestId(response.headers.get("x-request-id"))).toBe(true);
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

  expect(() =>
    GET(new Request("https://storefront.example.invalid/healthz")),
  ).toThrow(configError);
});

test("preserves one canonical request ID on a direct health invocation", async () => {
  const requestId = "018f47a4-7b7c-4f27-8b35-25c984619a11";
  const response = await GET(
    new Request("https://storefront.example.invalid/healthz", {
      headers: { "x-request-id": requestId },
    }),
  );

  expect(response.headers.get("x-request-id")).toBe(requestId);
});

test.each([
  "",
  "018F47A4-7B7C-4F27-8B35-25C984619A11",
  "018f47a4-7b7c-4f27-8b35-25c984619a11,other",
  "private-message-canary@example.invalid",
  "x".repeat(512),
])("replaces an untrusted direct health request ID %#", async (candidate) => {
  const response = await GET(
    new Request("https://storefront.example.invalid/healthz", {
      headers: { "x-request-id": candidate },
    }),
  );
  const requestId = response.headers.get("x-request-id");

  expect(isCanonicalRequestId(requestId)).toBe(true);
  expect(requestId).not.toBe(candidate);
});
