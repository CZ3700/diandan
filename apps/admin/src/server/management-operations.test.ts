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
