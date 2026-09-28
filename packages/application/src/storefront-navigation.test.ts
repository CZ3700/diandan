import { createHash, randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import {
  createDefaultStorefrontNavigation,
  storefrontNavigationCommandSchema,
  type StorefrontNavigationResponse,
} from "@fan-support/contracts";
import type {
  StorefrontNavigationRepositories,
  StorefrontNavigationTransactionManager,
} from "@fan-support/persistence-port";
import {
  createStorefrontNavigationUseCases,
  createPublicStorefrontNavigationUseCases,
} from "./storefront-navigation.js";
const state = {
  schemaVersion: 1 as const,
  version: 0,
  draft: null,
  published: null,
};
function setup(denied = false) {
  const execute = vi.fn<
    StorefrontNavigationRepositories["storefrontNavigation"]["execute"]
  >(async (): Promise<StorefrontNavigationResponse> => ({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "STATE",
    state,
    replayed: false,
  }));
  const authorize = vi.fn(async () =>
    denied
      ? {
          schemaVersion: 1 as const,
          outcome: "FAILURE" as const,
          code: "FORBIDDEN" as const,
        }
      : {
          schemaVersion: 1 as const,
          outcome: "SUCCESS" as const,
          principal: {
            schemaVersion: 1 as const,
            actorId: randomUUID(),
            sessionId: randomUUID(),
            expiresAt: "2030-01-01T00:00:00Z",
            authorizedAt: "2026-01-01T00:00:00Z",
          },
        },
  );
  const repositories: StorefrontNavigationRepositories = {
    authorization: { authorize },
    storefrontNavigation: {
      execute,
      readPublished: async () => {
        throw new Error("database unavailable");
      },
    },
  };
  const transactions: StorefrontNavigationTransactionManager = {
    runInStorefrontNavigationTransaction: async (work) => work(repositories),
  };
  const app = createStorefrontNavigationUseCases({
    transactions,
    tokenPepper: "a".repeat(64),
  });
  const request = (command: unknown) =>
    app.execute({
      schemaVersion: 1,
      requestId: randomUUID(),
      sessionToken: "a".repeat(42) + "A",
      csrfToken: "b".repeat(42) + "A",
      command,
    });
  return { request, authorize, execute, transactions };
}
test("authorization is action-scoped without granting or requiring translations", async () => {
  const fixture = setup();
  for (const [command, permission] of [
    [{ schemaVersion: 1, action: "READ" }, "content.read"],
    [
      { schemaVersion: 1, action: "HISTORY", page: 1, pageSize: 10 },
      "content.read",
    ],
    [
      {
        schemaVersion: 1,
        action: "SAVE_DRAFT",
        expectedVersion: 0,
        idempotencyKey: "navigation-save-00000001",
        navigation: createDefaultStorefrontNavigation(),
      },
      "content.edit",
    ],
    [
      {
        schemaVersion: 1,
        action: "PUBLISH",
        expectedVersion: 1,
        idempotencyKey: "navigation-publish-00000001",
        draftRevisionId: randomUUID(),
      },
      "content.publish",
    ],
    [
      {
        schemaVersion: 1,
        action: "RESTORE",
        expectedVersion: 2,
        idempotencyKey: "navigation-restore-00000001",
        publicationId: randomUUID(),
      },
      "content.publish",
    ],
  ] as const) {
    expect((await fixture.request(command)).outcome).toBe("SUCCESS");
    expect(fixture.authorize).toHaveBeenLastCalledWith(
      expect.objectContaining({
        permission,
        locales: [],
        sessionTokenDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
  }
});
test("malformed navigation is rejected before authorization or persistence", async () => {
  const fixture = setup();
  expect(
    await fixture.request({
      schemaVersion: 1,
      action: "SAVE_DRAFT",
      expectedVersion: 0,
      idempotencyKey: "navigation-invalid-00000001",
      navigation: {
        ...createDefaultStorefrontNavigation(),
        header: ["HOME", "HOME", "GIFTS"],
      },
    }),
  ).toMatchObject({ outcome: "FAILURE", code: "INVALID_COMMAND" });
  expect(fixture.authorize).not.toHaveBeenCalled();
  expect(fixture.execute).not.toHaveBeenCalled();
});
test("receipt hash covers the parsed order and every visibility choice", async () => {
  const fixture = setup();
  const first = storefrontNavigationCommandSchema.parse({
    schemaVersion: 1,
    action: "SAVE_DRAFT",
    expectedVersion: 0,
    idempotencyKey: "navigation-hash-00000001",
    navigation: createDefaultStorefrontNavigation(),
  });
  await fixture.request(first);
  expect(fixture.execute).toHaveBeenLastCalledWith(
    expect.objectContaining({
      command: first,
      requestHash: createHash("sha256")
        .update(JSON.stringify(first))
        .digest("hex"),
    }),
  );
  const before = fixture.execute.mock.calls.at(-1)?.[0].requestHash;
  await fixture.request({
    ...first,
    navigation: {
      ...createDefaultStorefrontNavigation(),
      header: ["GIFTS", "HOME", "ARTISTS"],
    },
  });
  expect(fixture.execute.mock.calls.at(-1)?.[0].requestHash).not.toEqual(
    before,
  );
});
test("unauthorized requests never reach navigation data and public database failures are not DEFAULT", async () => {
  const fixture = setup(true);
  expect(
    await fixture.request({ schemaVersion: 1, action: "READ" }),
  ).toMatchObject({ outcome: "FAILURE", code: "FORBIDDEN" });
  expect(fixture.execute).not.toHaveBeenCalled();
  expect(
    await createPublicStorefrontNavigationUseCases({
      transactions: fixture.transactions,
    }).execute(),
  ).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CONTENT_UNAVAILABLE",
  });
});
