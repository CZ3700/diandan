import { expect, it } from "vitest";
import { createManagementApi } from "./api";
import { createAdminClient } from "../workspace/client";

const id = "10000000-0000-4000-8000-000000000001";
const operation = {
  operationId: id,
  version: 1,
  kind: "SAVE_ARTIST",
  sourceLocale: "zh-CN",
  status: "PROCESSING",
  targetId: null,
  updatedAt: "2026-09-08T00:00:00Z",
  result: null,
  failure: null,
};
function setup(response: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const client = createAdminClient(
    () => "local-test-csrf",
    () => {},
    (async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return Response.json(response);
    }) as typeof fetch,
  );
  return { api: createManagementApi(client), calls };
}
it("keeps CSRF and idempotency in the existing BFF transport", async () => {
  const { api, calls } = setup({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "OPERATION",
    operation,
  });
  await api.submit({
    kind: "SAVE_ARTIST",
    sourceLocale: "zh-CN",
    id: null,
    expectedVersion: 0,
    name: "测试艺人",
    description: "测试介绍",
    image: { uploadId: id },
  });
  expect(calls[0]?.url).toBe("/api/admin/management-submit");
  const headers = new Headers(calls[0]?.init.headers);
  expect(headers.get("X-CSRF-Token")).toBe("local-test-csrf");
  expect(headers.get("Idempotency-Key")).toBeTruthy();
  expect(calls[0]?.init.credentials).toBe("same-origin");
});
it("rejects a structurally valid list for another section or page", async () => {
  const { api } = setup({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "LIST",
    section: "GIFTS",
    page: 1,
    pageSize: 12,
    totalItems: 0,
    items: [],
  });
  await expect(api.list("ARTISTS", 1)).rejects.toThrow("INVALID_RESPONSE");
  await expect(api.list("GIFTS", 2)).rejects.toThrow("INVALID_RESPONSE");
});
it("rejects a valid operation belonging to another requested update", async () => {
  const { api } = setup({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "OPERATION",
    operation,
  });
  await expect(
    api.read("10000000-0000-4000-8000-000000000002"),
  ).rejects.toThrow("INVALID_RESPONSE");
});
