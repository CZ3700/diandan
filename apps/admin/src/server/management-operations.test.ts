import { expect, test } from "vitest";
import { getAdminOperation } from "./admin-operations";
const id = "10000000-0000-4000-8000-000000000001";

test("management submit binds its action and idempotency at the private BFF", () => {
  const operation = getAdminOperation("management-submit");
  expect(operation).toBeDefined();
  const body = {
    schemaVersion: 1,
    intent: {
      kind: "SAVE_ARTIST",
      sourceLocale: "zh-CN",
      id: null,
      expectedVersion: 0,
      name: "艺人",
      description: "介绍",
      image: { uploadId: id },
    },
  };
  expect(operation!.path).toBe("/api/v1/admin/management/submit");
  expect(operation!.parseCommand(body, id)).toEqual({
    ...body,
    action: "SUBMIT",
    idempotencyKey: id,
  });
  expect(operation!.apiBody(operation!.parseCommand(body, id))).toEqual(body);
  for (const extra of [
    { actorId: id },
    { action: "CONTEXT" },
    { sessionToken: "secret" },
    { idempotencyKey: id },
  ])
    expect(() => operation!.parseCommand({ ...body, ...extra }, id)).toThrow();
  expect(() => operation!.parseCommand(body)).toThrow();
});

test("management reads stay authenticated and reject mismatched success payloads", () => {
  for (const key of [
    "management-context",
    "management-list",
    "management-read-operation",
    "management-read-image-source",
  ]) {
    const operation = getAdminOperation(key);
    expect(operation).toBeDefined();
    expect(operation!.credentials).toBe("SESSION");
    expect(operation!.readOnly).toBe(true);
  }
  expect(() =>
    getAdminOperation("management-context")!.parseResponse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "LIST",
      section: "ARTISTS",
      page: 1,
      pageSize: 20,
      totalItems: 0,
      items: [],
    }),
  ).toThrow();
});

test("original-image BFF binds the private descriptor to the exact requested target and version", () => {
  const operation = getAdminOperation("management-read-image-source")!;
  const target = { kind: "ARTIST", id, expectedVersion: 4 };
  const command = operation.parseCommand({ schemaVersion: 1, target });
  const response = operation.parseResponse({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "ORIGINAL_IMAGE",
    target,
    currentImage: { assetId: id, metadataRevisionId: id },
    focalPoint: { x: 0.5, y: 0.3 },
    sourceWidth: 2000,
    sourceHeight: 3000,
    download: {
      method: "GET",
      url: "https://storage.example.invalid/original",
      headers: {},
      expiresAt: "2099-01-01T00:00:00Z",
    },
  });
  expect(operation.responseMatches).toBeTypeOf("function");
  expect(operation.responseMatches!(command, response)).toBe(true);
  for (const changed of [
    { kind: "GIFT" },
    { id: "10000000-0000-4000-8000-000000000002" },
    { expectedVersion: 5 },
  ]) {
    expect(
      operation.responseMatches!(command, {
        ...(response as object),
        target: { ...target, ...changed },
      }),
    ).toBe(false);
  }
  expect(
    operation.responseMatches!(command, {
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "REUPLOAD_REQUIRED",
    }),
  ).toBe(true);
});

test("assigning an artist is a private idempotent mutation with no caller-supplied authority", () => {
  const operation = getAdminOperation("management-assign-artist");
  expect(operation).toBeDefined();
  const body = {
    schemaVersion: 1,
    artistId: id,
    brokerId: id,
    expectedBrokerId: null,
  };
  expect(operation!.path).toBe("/api/v1/admin/management/artists/assign");
  expect(operation!.readOnly).toBe(false);
  expect(operation!.parseCommand(body, id)).toEqual({
    ...body,
    action: "ASSIGN_ARTIST",
    idempotencyKey: id,
  });
  expect(operation!.apiBody(operation!.parseCommand(body, id))).toEqual(body);
  for (const extra of [{ actorId: id }, { action: "SUBMIT" }])
    expect(() => operation!.parseCommand({ ...body, ...extra }, id)).toThrow();
  expect(() => operation!.parseCommand(body)).toThrow();
  expect(() =>
    operation!.parseResponse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "POSTER_ARCHIVED",
      revisionId: id,
    }),
  ).toThrow();
});
