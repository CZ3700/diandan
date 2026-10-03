import { createHash, randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import {
  SUPPORTED_LOCALES,
  informationPageCommandSchema,
  type InformationPageAuthorizationCommand,
  type AdminPrincipal,
} from "@fan-support/contracts";
import type {
  InformationPageRepositories,
  InformationPageTransactionManager,
} from "@fan-support/persistence-port";
import {
  createInformationPageUseCases,
  createPublicInformationPageUseCases,
} from "./information-pages.js";
const never = {
  runInInformationPageTransaction: async () => {
    throw new Error("must not run");
  },
};
function fixture(
  options: {
    expired?: boolean;
    deny?: (command: InformationPageAuthorizationCommand) => boolean;
    changedSession?: boolean;
  } = {},
) {
  const principal: AdminPrincipal = {
    schemaVersion: 1,
    actorId: randomUUID(),
    sessionId: randomUUID(),
    authorizedAt: "2026-09-29T00:00:00Z",
    expiresAt: options.expired
      ? "2026-09-28T00:00:00Z"
      : "2030-01-01T00:00:00Z",
  };
  let calls = 0;
  const authorize = vi.fn<
    InformationPageRepositories["authorization"]["authorize"]
  >(async (command) => {
    calls++;
    return options.deny?.(command)
      ? { schemaVersion: 1, outcome: "FAILURE", code: "FORBIDDEN" }
      : {
          schemaVersion: 1,
          outcome: "SUCCESS",
          principal:
            options.changedSession && calls > 1
              ? { ...principal, sessionId: randomUUID() }
              : principal,
        };
  });
  const execute = vi.fn<
    InformationPageRepositories["informationPages"]["execute"]
  >(async () => ({ schemaVersion: 1, outcome: "FAILURE", code: "NOT_FOUND" }));
  const repositories: InformationPageRepositories = {
    authorization: { authorize },
    informationPages: {
      execute,
      readPublished: async () => {
        throw new Error("unavailable");
      },
      readIndex: async () => {
        throw new Error("unavailable");
      },
    },
  };
  const transactions: InformationPageTransactionManager = {
    runInInformationPageTransaction: async (work) => work(repositories),
  };
  const app = createInformationPageUseCases({
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
const read = {
  schemaVersion: 1,
  action: "READ",
  pageKey: "ABOUT",
  locale: "ja",
};
test("invalid information commands never enter a transaction", async () => {
  expect(
    await createInformationPageUseCases({
      transactions: never,
      tokenPepper: "a".repeat(64),
    }).execute({ action: "SAVE_DRAFT", pageKey: "DELIVERY" }),
  ).toMatchObject({ code: "INVALID_COMMAND" });
});
test("public unknown pages avoid private reads and storage failures fail closed", async () => {
  expect(
    await createPublicInformationPageUseCases({ transactions: never }).execute({
      schemaVersion: 1,
      pageKey: "POLICY",
      locale: "en",
    }),
  ).toMatchObject({ code: "INVALID_COMMAND" });
  const f = fixture();
  expect(
    await createPublicInformationPageUseCases({
      transactions: f.transactions,
    }).execute({ schemaVersion: 1, pageKey: "ABOUT", locale: "en" }),
  ).toMatchObject({ code: "CONTENT_UNAVAILABLE" });
});
test("expired or changing authorization cannot reach saved drafts", async () => {
  for (const options of [{ expired: true }, { changedSession: true }]) {
    const f = fixture(options);
    expect(await f.request(read)).toMatchObject({
      code: "CONTENT_UNAVAILABLE",
    });
    expect(f.execute).not.toHaveBeenCalled();
  }
});
test("restricted locale capabilities are derived from current authorization", async () => {
  const f = fixture({
    deny: (c) =>
      c.permission !== "content.read" || c.locales.some((l) => l !== "ja"),
  });
  await f.request(read);
  expect(f.execute).toHaveBeenCalledWith(
    expect.objectContaining({
      access: {
        readLocales: ["ja"],
        editLocales: [],
        reviewLocales: [],
        canPublish: false,
        canPreview: false,
      },
    }),
  );
  expect(JSON.stringify(f.authorize.mock.calls)).not.toContain(
    "a".repeat(42) + "A",
  );
});
test("source writes and publication require all seven locale grants before persistence", async () => {
  const id = randomUUID();
  for (const command of [
    {
      schemaVersion: 1,
      action: "PUBLISH",
      pageKey: "ABOUT",
      locale: "en",
      expectedVersion: 1,
      idempotencyKey: randomUUID(),
      revisionId: id,
    },
    {
      schemaVersion: 1,
      action: "SAVE_DRAFT",
      pageKey: "ABOUT",
      locale: "en",
      expectedVersion: 0,
      idempotencyKey: randomUUID(),
      revisionId: null,
      expectedSourceHash: null,
      structure: { sectionIds: [id], contactEmail: null },
      fields: {
        title: "About",
        summary: "",
        sections: [{ id, heading: "", body: "Body" }],
      },
    },
  ]) {
    const f = fixture({ deny: (c) => c.locales.length === 7 });
    expect(await f.request(command)).toMatchObject({ code: "FORBIDDEN" });
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ locales: [...SUPPORTED_LOCALES] }),
    );
  }
});
test("review actions are bound to selected locale and parsed request hash", async () => {
  const f = fixture();
  const command = informationPageCommandSchema.parse({
    schemaVersion: 1,
    action: "APPROVE_REVIEW",
    pageKey: "ABOUT",
    locale: "ja",
    expectedVersion: 3,
    idempotencyKey: randomUUID(),
    revisionId: randomUUID(),
    expectedContentHash: "a".repeat(64),
    expectedSourceHash: "b".repeat(64),
    expectedReviewSequence: 2,
  });
  await f.request(command);
  expect(f.authorize).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      permission: "content.translation.review",
      locales: ["ja"],
    }),
  );
  expect(f.execute).toHaveBeenCalledWith(
    expect.objectContaining({
      command,
      requestHash: createHash("sha256")
        .update(JSON.stringify(command))
        .digest("hex"),
    }),
  );
});
