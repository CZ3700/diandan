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
it("archives an old poster through its own mutation and refuses another poster's result", async () => {
  const poster = {
    kind: "POSTER" as const,
    id,
    version: 4,
    sourceLocale: "ja" as const,
    sourceRevisionId: id,
    current: false,
    image: null,
    canRestore: false,
    canDelete: true,
    createdAt: "2026-09-08T00:00:00Z",
  };
  const { api, calls } = setup({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "POSTER_ARCHIVED",
    revisionId: id,
  });
  await api.archivePoster(poster);
  expect(calls[0]?.url).toContain("management-archive-poster");
  expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
    revisionId: id,
    expectedVersion: 4,
    sourceLocale: "ja",
  });
  expect(
    new Headers(calls[0]?.init.headers).get("idempotency-key"),
  ).toBeTruthy();
  const other = setup({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "POSTER_ARCHIVED",
    revisionId: "10000000-0000-4000-8000-000000000009",
  });
  await expect(other.api.archivePoster(poster)).rejects.toThrow();
});

// ADR-022 / L3-11
const brokerId = "10000000-0000-4000-8000-000000000002";
it("sends the assignment filter only when one is chosen", async () => {
  const { api, calls } = setup({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "LIST",
    section: "ARTISTS",
    page: 1,
    pageSize: 12,
    totalItems: 0,
    items: [],
  });
  await api.list("ARTISTS", 1);
  await api.list("ARTISTS", 1, null);
  await api.list("ARTISTS", 1, { kind: "UNASSIGNED" });
  await api.list("ARTISTS", 1, { kind: "BROKER", brokerId });
  const bodies = calls.map((call) => JSON.parse(String(call.init.body)));
  expect(calls.every((call) => call.url === "/api/admin/management-list")).toBe(
    true,
  );
  expect(bodies.map((body) => body.assignment)).toEqual([
    undefined,
    undefined,
    { kind: "UNASSIGNED" },
    { kind: "BROKER", brokerId },
  ]);
});
it("assigns through an idempotent mutation and accepts only the artist and broker it asked for", async () => {
  const assigned = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "ARTIST_ASSIGNED",
    artistId: id,
    assignment: { brokerId, displayName: "Mina Park", active: true },
  };
  const { api, calls } = setup(assigned);
  expect(await api.assignArtist(id, brokerId, null)).toEqual(
    assigned.assignment,
  );
  expect(calls[0]?.url).toBe("/api/admin/management-assign-artist");
  expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
    schemaVersion: 1,
    artistId: id,
    brokerId,
    expectedBrokerId: null,
  });
  expect(
    new Headers(calls[0]?.init.headers).get("Idempotency-Key"),
  ).toBeTruthy();
  // The server answered about another broker, another artist, or "unassigned".
  await expect(api.assignArtist(id, id, null)).rejects.toThrow(
    "INVALID_RESPONSE",
  );
  await expect(api.assignArtist(brokerId, brokerId, null)).rejects.toThrow(
    "INVALID_RESPONSE",
  );
  await expect(api.assignArtist(id, null, brokerId)).rejects.toThrow(
    "INVALID_RESPONSE",
  );
  const cleared = setup({ ...assigned, assignment: null });
  expect(await cleared.api.assignArtist(id, null, brokerId)).toBeNull();
  const refused = setup({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "TARGET_CONFLICT",
  });
  await expect(refused.api.assignArtist(id, brokerId, null)).rejects.toThrow(
    "TARGET_CONFLICT",
  );
});
