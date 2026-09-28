import { expect, test } from "vitest";
import { getAdminOperation } from "./admin-operations";
import { navigationFixture } from "../management-decoration/navigation-fixture";
const id = "10000000-0000-4000-8000-000000000001";
test("navigation commands use their own allowlisted routes, session and idempotency boundaries", () => {
  for (const [suffix, action, body, mutation] of [
    ["read", "READ", {}, false],
    [
      "draft",
      "SAVE_DRAFT",
      { navigation: navigationFixture(), expectedVersion: 0 },
      true,
    ],
    ["publish", "PUBLISH", { draftRevisionId: id, expectedVersion: 1 }, true],
    ["restore", "RESTORE", { publicationId: id, expectedVersion: 2 }, true],
    ["history", "HISTORY", { page: 1, pageSize: 10 }, false],
  ] as const) {
    const operation = getAdminOperation(`storefront-navigation-${suffix}`);
    expect(operation).toBeDefined();
    expect(operation!.path).toBe(
      `/api/v1/admin/storefront-navigation/${suffix}`,
    );
    expect(operation!.credentials).toBe("SESSION");
    expect(operation!.readOnly).toBe(!mutation);
    expect(
      operation!.parseCommand(
        { schemaVersion: 1, ...body },
        mutation ? id : undefined,
      ),
    ).toMatchObject({ action, ...body });
    if (mutation)
      expect(() =>
        operation!.parseCommand({ schemaVersion: 1, ...body }),
      ).toThrow();
    expect(() =>
      operation!.parseCommand({ schemaVersion: 1, ...body, actorId: id }, id),
    ).toThrow();
  }
});
