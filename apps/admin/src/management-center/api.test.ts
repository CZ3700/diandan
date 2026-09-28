import { expect, it } from "vitest";
import { createManagementApi, type DeletableItem } from "./api";
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
const deletable = (kind: "ARTIST" | "GIFT", version: number) =>
  ({ kind, id, version }) as unknown as DeletableItem;
it("deletes an artist as a permanent archive through the audited identity write", async () => {
  const { api, calls } = setup({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "MUTATION",
    resultId: id,
    idolId: id,
    baseVersion: 4,
    authoringVersion: 1,
    publicationHeadVersion: 1,
    handle: "test-artist",
    status: "archived",
    acceptingGifts: false,
    draftRevisionId: null,
    publishedRevisionId: id,
    replayed: false,
  });
  await api.remove(deletable("ARTIST", 3));
  expect(calls[0]?.url).toBe("/api/admin/idol-status");
  expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
    schemaVersion: 1,
    idolId: id,
    status: "archived",
    acceptingGifts: false,
    expectedBaseVersion: 3,
    reasonCode: "DAILY_CENTER_DELETE",
  });
  expect(
    new Headers(calls[0]?.init.headers).get("Idempotency-Key"),
  ).toBeTruthy();
});
it("deletes a gift through the gift status write and refuses another gift's result", async () => {
  const response = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "MUTATION",
    resultId: id,
    replayed: false,
    action: "SET_GIFT_STATUS",
    giftId: id,
    baseVersion: 6,
  };
  const { api, calls } = setup(response);
  await api.remove(deletable("GIFT", 5));
  expect(calls[0]?.url).toBe("/api/admin/gift-status");
  expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
    giftId: id,
    expectedBaseVersion: 5,
    status: "archived",
    reasonCode: "DAILY_CENTER_DELETE",
  });
  const other = setup({
    ...response,
    giftId: "10000000-0000-4000-8000-000000000009",
  });
  await expect(other.api.remove(deletable("GIFT", 5))).rejects.toMatchObject({
    code: "INVALID_RESPONSE",
  });
});
it("offers gift deletion only with gift.manage and treats a failed context as no permission", async () => {
  const context = (permissions: string[]) => ({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "COMMERCE_CONTEXT",
    markets: [],
    inventoryLocations: [],
    permissions,
    localeScopes: ["en"],
  });
  expect(
    await setup(context(["commerce.read", "gift.manage"])).api.canDeleteGifts(),
  ).toBe(true);
  expect(await setup(context(["commerce.read"])).api.canDeleteGifts()).toBe(
    false,
  );
  expect(
    await setup({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "FORBIDDEN",
    }).api.canDeleteGifts(),
  ).toBe(false);
});
it("reads an original only for the exact requested content version", async () => {
  const target = { kind: "ARTIST" as const, id, expectedVersion: 2 };
  const response = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "ORIGINAL_IMAGE",
    target,
    currentImage: { assetId: id, metadataRevisionId: id },
    focalPoint: { x: 0.2, y: 0.4 },
    sourceWidth: 2000,
    sourceHeight: 1600,
    download: {
      method: "GET",
      url: "https://storage.example.invalid/original",
      headers: {},
      expiresAt: "2099-01-01T00:00:00Z",
    },
  };
  const { api, calls } = setup(response);
  await expect(api.readImageSource(target)).resolves.toMatchObject({ target });
  expect(calls[0]?.url).toBe("/api/admin/management-read-image-source");
  expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
    schemaVersion: 1,
    target,
  });
  await expect(
    api.readImageSource({ ...target, expectedVersion: 3 }),
  ).rejects.toThrow("INVALID_RESPONSE");
  await expect(
    api.readImageSource({ ...target, kind: "GIFT" }),
  ).rejects.toThrow("INVALID_RESPONSE");
});
