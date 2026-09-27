import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import {
  createDefaultHomeLayout,
  type HomeLayoutResponse,
} from "@fan-support/contracts";
import type {
  HomeLayoutRepositories,
  HomeLayoutTransactionManager,
} from "@fan-support/persistence-port";
import {
  createHomeLayoutUseCases,
  createPublicHomeLayoutUseCases,
} from "./home-layout.js";
const state = {
  schemaVersion: 1 as const,
  version: 0,
  draft: null,
  published: null,
};
function setup(denied = false) {
  const execute = vi.fn(async (): Promise<HomeLayoutResponse> => ({
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
  const repositories: HomeLayoutRepositories = {
    authorization: { authorize },
    homeLayout: {
      execute,
      readPublished: async () => {
        throw new Error("database unavailable");
      },
    },
  };
  const transactions: HomeLayoutTransactionManager = {
    runInHomeLayoutTransaction: async (work) => work(repositories),
  };
  const app = createHomeLayoutUseCases({
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
      {
        schemaVersion: 1,
        action: "SAVE_DRAFT",
        expectedVersion: 0,
        idempotencyKey: "layout-save-00000001",
        layout: createDefaultHomeLayout(),
      },
      "content.edit",
    ],
    [
      {
        schemaVersion: 1,
        action: "PUBLISH",
        expectedVersion: 1,
        idempotencyKey: "layout-publish-00000001",
        draftRevisionId: randomUUID(),
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
test("unauthorized requests never reach layout data and public database failures are not DEFAULT", async () => {
  const fixture = setup(true);
  expect(
    await fixture.request({ schemaVersion: 1, action: "READ" }),
  ).toMatchObject({ outcome: "FAILURE", code: "FORBIDDEN" });
  expect(fixture.execute).not.toHaveBeenCalled();
  expect(
    await createPublicHomeLayoutUseCases({
      transactions: fixture.transactions,
    }).execute(),
  ).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CONTENT_UNAVAILABLE",
  });
});
