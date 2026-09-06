import { expect, test } from "vitest";
import { getAdminOperation } from "./admin-operations";

const key = "commerce-create-gift-fixture";
const body = {
  schemaVersion: 1,
  handle: "studio-gift",
  expectedBaseVersion: 0,
  reasonCode: "STUDIO_CATALOG_SETUP",
};

test("gift creation is an explicit fixed API operation with server-injected action", () => {
  const operation = getAdminOperation("gift-create");
  expect(operation).toBeDefined();
  expect(operation!.path).toBe("/api/v1/admin/gift-commerce/gifts/create");
  expect(operation!.credentials).toBe("SESSION");
  expect(operation!.readOnly).toBe(false);
  const command = operation!.parseCommand(body, key);
  expect(command).toEqual({
    ...body,
    action: "CREATE_GIFT",
    idempotencyKey: key,
  });
  expect(operation!.apiBody(command)).toEqual(body);
});

test("commerce BFF rejects body authority and absent idempotency before forwarding", () => {
  const operation = getAdminOperation("gift-create");
  expect(operation).toBeDefined();
  expect(() => operation!.parseCommand(body)).toThrow();
  for (const injected of [
    { actorId: "10000000-0000-4000-8000-000000000001" },
    { action: "SET_GIFT_STATUS" },
    { sessionToken: "synthetic-invalid" },
    { idempotencyKey: key },
    { occurredAt: "2026-09-07T00:00:00Z" },
  ])
    expect(() =>
      operation!.parseCommand({ ...body, ...injected }, key),
    ).toThrow();
});

test("commerce capabilities use a new read operation without changing session bootstrap", () => {
  const operation = getAdminOperation("commerce-context");
  expect(operation).toBeDefined();
  expect(operation!.path).toBe("/api/v1/admin/gift-commerce/context/read");
  expect(operation!.parseCommand({ schemaVersion: 1 })).toEqual({
    schemaVersion: 1,
    action: "CONTEXT",
  });
  expect(operation!.readOnly).toBe(true);
  expect(getAdminOperation("session")!.path).toBe("/api/v1/admin/session/read");
});

test("the fixed commerce operation cannot return a different action receipt", () => {
  const operation = getAdminOperation("gift-create");
  expect(operation).toBeDefined();
  expect(() =>
    operation!.parseResponse({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "MUTATION",
      action: "SET_GIFT_STATUS",
      resultId: "10000000-0000-4000-8000-000000000001",
      giftId: "10000000-0000-4000-8000-000000000002",
      baseVersion: 2,
      replayed: false,
    }),
  ).toThrow();
});
