import { expect, test } from "vitest";
import { getAdminOperation } from "./admin-operations";
const id = "10000000-0000-4000-8000-000000000001";
test.each([
  ["read", "READ", false],
  ["draft", "SAVE_DRAFT", true],
  ["publish", "PUBLISH", true],
  ["restore", "RESTORE", true],
  ["history", "HISTORY", false],
  ["prepare", "PREPARE_LOGO", true],
] as const)(
  "brand %s uses its own session-scoped fixed route",
  (path, _action, mutation) => {
    const operation = getAdminOperation(`storefront-brand-${path}`);
    expect(operation).toBeDefined();
    expect(operation!.path).toBe(`/api/v1/admin/storefront-brand/${path}`);
    expect(operation!.credentials).toBe("SESSION");
    expect(operation!.readOnly).toBe(!mutation);
    expect(() =>
      operation!.parseCommand({ schemaVersion: 1, actorId: id }, id),
    ).toThrow();
  },
);
test("fixed operations parse actionless bodies and bind idempotency separately", () => {
  const operation = getAdminOperation("idol-create")!;
  expect(operation.path).toBe("/api/v1/admin/catalog/idols/create");
  expect(
    operation.parseCommand(
      {
        schemaVersion: 1,
        handle: "example-idol",
        expectedBaseVersion: 0,
        reasonCode: "EDITOR_CREATE",
      },
      id,
    ),
  ).toMatchObject({ action: "CREATE_IDOL", idempotencyKey: id });
  expect(() =>
    operation.parseCommand({
      schemaVersion: 1,
      handle: "example-idol",
      expectedBaseVersion: 0,
      reasonCode: "EDITOR_CREATE",
    }),
  ).toThrow();
  expect(() =>
    operation.parseCommand({ schemaVersion: 1, actorId: id }, id),
  ).toThrow();
  expect(getAdminOperation("https://example.com")).toBeUndefined();
  expect(getAdminOperation("__proto__")).toBeUndefined();
});
test("preflight retains its requested action while preview keeps token-only protocol", () => {
  const target = { owner: { kind: "HOMEPAGE" }, revisionId: id };
  expect(
    getAdminOperation("publication-preflight")!.parseCommand({
      schemaVersion: 1,
      target,
      action: "ROLLBACK",
    }),
  ).toMatchObject({ action: "ROLLBACK" });
  expect(getAdminOperation("preview-content-read")!.credentials).toBe(
    "PREVIEW",
  );
  expect(getAdminOperation("review-read")!.path).not.toBe(
    getAdminOperation("alias-review-read")!.path,
  );
});
