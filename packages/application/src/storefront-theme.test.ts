import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import {
  createDefaultStorefrontTheme,
  createDefaultStorefrontPresentation,
  type StorefrontThemeResponse,
} from "@fan-support/contracts";
import type {
  StorefrontThemeRepositories,
  StorefrontThemeTransactionManager,
} from "@fan-support/persistence-port";
import {
  createStorefrontThemeUseCases,
  createPublicStorefrontThemeUseCases,
} from "./storefront-theme.js";
const state = {
  schemaVersion: 1 as const,
  version: 0,
  draft: null,
  published: null,
};
function setup(denied = false) {
  const execute = vi.fn(async (): Promise<StorefrontThemeResponse> => ({
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
  const repositories: StorefrontThemeRepositories = {
    authorization: { authorize },
    storefrontTheme: {
      execute,
      readPublished: async () => {
        throw new Error("database unavailable");
      },
    },
  };
  const transactions: StorefrontThemeTransactionManager = {
    runInStorefrontThemeTransaction: async (work) => work(repositories),
  };
  const app = createStorefrontThemeUseCases({
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
  return { request, authorize, execute, transactions, repositories };
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
        idempotencyKey: "theme-save-00000001",
        theme: createDefaultStorefrontTheme(),
      },
      "content.edit",
    ],
    [
      {
        schemaVersion: 1,
        action: "PUBLISH",
        expectedVersion: 1,
        idempotencyKey: "theme-publish-00000001",
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
test("unauthorized requests never reach theme data and public database failures are not DEFAULT", async () => {
  const fixture = setup(true);
  expect(
    await fixture.request({ schemaVersion: 1, action: "READ" }),
  ).toMatchObject({ outcome: "FAILURE", code: "FORBIDDEN" });
  expect(fixture.execute).not.toHaveBeenCalled();
  expect(
    await createPublicStorefrontThemeUseCases({
      transactions: fixture.transactions,
    }).execute(),
  ).toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "CONTENT_UNAVAILABLE",
  });
});

test("optional hero effects cross the transaction boundary as canonical JSON", async () => {
  const fixture = setup();
  const theme = {
    ...createDefaultStorefrontTheme(),
    presentation: {
      ...createDefaultStorefrontPresentation(),
      heroEffect: undefined,
    },
  };
  fixture.repositories.storefrontTheme.readPublished = async () => ({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "STOREFRONT_THEME",
    source: "DEFAULT",
    theme,
    version: 0,
    publicationId: null,
  });
  const app = createPublicStorefrontThemeUseCases({
    transactions: {
      runInStorefrontThemeTransaction: async (work) => {
        const result = await work(fixture.repositories);
        expect(result).toStrictEqual(JSON.parse(JSON.stringify(result)));
        return result;
      },
    },
  });
  const result = await app.execute();
  expect(result.outcome).toBe("SUCCESS");
  if (result.outcome === "SUCCESS")
    expect(result.theme).toEqual({
      ...createDefaultStorefrontTheme(),
      presentation: createDefaultStorefrontPresentation(),
    });
});

test("new effect commands preserve their exact effect, motion and speed", async () => {
  const fixture = setup();
  for (const heroEffect of [
    "STARLIGHT",
    "AURORA",
    "SPOTLIGHT",
    "PETALS",
  ] as const) {
    const command = {
      schemaVersion: 1,
      action: "SAVE_DRAFT",
      expectedVersion: 0,
      idempotencyKey: "hero-effect-save-0000001",
      theme: {
        ...createDefaultStorefrontTheme(),
        presentation: {
          ...createDefaultStorefrontPresentation(),
          heroEffect,
          motion: "NONE",
          motionSpeed: "QUICK",
        },
      },
    };
    expect((await fixture.request(command)).outcome).toBe("SUCCESS");
    expect(fixture.execute).toHaveBeenLastCalledWith(
      expect.objectContaining({ command }),
    );
  }
});
