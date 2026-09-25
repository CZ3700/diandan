import { expect, test, vi } from "vitest";
import {
  giftCommerceAuthorizationCommandSchema,
  sourceHashSchema,
} from "@fan-support/contracts";
import { createGiftCommerceAuthorizationRepository } from "./gift-commerce-authorization-repository.js";

const actorId = "10000000-0000-4000-8000-000000000001";
const sessionId = "10000000-0000-4000-8000-000000000002";
const command = giftCommerceAuthorizationCommandSchema.parse({
  schemaVersion: 1,
  sessionTokenDigest: "a".repeat(64),
  csrfTokenDigest: "b".repeat(64),
  permission: "pricing.manage",
  locales: [],
});
const session = {
  actor_id: actorId,
  session_id: sessionId,
  csrf_token_digest: Buffer.from(command.csrfTokenDigest, "hex"),
  expires_at: "2026-09-06T21:00:00.123456Z",
  now: "2026-09-06T20:30:00.000789Z",
};
function setup(rows: unknown[][] = []) {
  const query = vi.fn(async () => ({ rows: rows.shift() ?? [] }));
  return {
    query,
    repository: createGiftCommerceAuthorizationRepository(
      { query, release: () => undefined },
      { markRollbackOnly: vi.fn(), trackOperation: async (work) => work() },
    ),
  };
}

test("commerce authorization preserves canonical principal precision with its own permission", async () => {
  const { repository } = setup([
    [session],
    [{ role_id: actorId, authorized_at: session.now }],
  ]);
  expect(await repository.authorize(command)).toEqual({
    schemaVersion: 1,
    outcome: "SUCCESS",
    principal: {
      schemaVersion: 1,
      actorId,
      sessionId,
      expiresAt: session.expires_at,
      authorizedAt: session.now,
    },
  });
});

test("invented and legacy permissions cannot enter the commerce authorization repository", async () => {
  const { query, repository } = setup();
  for (const permission of [
    "content.publish",
    "commerce.root",
    "inventory.manage.*",
  ])
    expect(
      await repository.authorize({ ...command, permission } as never),
    ).toMatchObject({ code: "INVALID_COMMAND" });
  expect(query).not.toHaveBeenCalled();
});

test("absent session and mismatched CSRF cannot reveal or read commerce grants", async () => {
  expect(await setup().repository.authorize(command)).toMatchObject({
    code: "UNAUTHENTICATED",
  });
  const { query, repository } = setup([[session]]);
  expect(
    await repository.authorize({
      ...command,
      csrfTokenDigest: sourceHashSchema.parse("c".repeat(64)),
    }),
  ).toMatchObject({ code: "CSRF_INVALID" });
  expect(query).toHaveBeenCalledTimes(1);
});

test("neither a role nor an assigned locale is inferred from a valid session", async () => {
  expect(await setup([[session]]).repository.authorize(command)).toMatchObject({
    code: "FORBIDDEN",
  });
  expect(
    await setup([
      [session],
      [{ role_id: actorId, authorized_at: session.now }],
      [],
    ]).repository.authorize({ ...command, locales: ["ja"] }),
  ).toMatchObject({ code: "FORBIDDEN" });
});

test("database exceptions are converted without carrying the original connection message", async () => {
  const repository = createGiftCommerceAuthorizationRepository(
    {
      query: async () => {
        throw new Error("private connection details");
      },
      release: () => undefined,
    },
    { markRollbackOnly: vi.fn(), trackOperation: async (work) => work() },
  );
  await expect(repository.authorize(command)).rejects.toMatchObject({
    name: "PersistenceTransactionFailureError",
  });
});

test("commerce context exposes only distinct new capabilities and canonical locale grants", async () => {
  const input = {
    schemaVersion: command.schemaVersion,
    sessionTokenDigest: command.sessionTokenDigest,
    csrfTokenDigest: command.csrfTokenDigest,
  };
  const { repository } = setup([
    [session],
    [
      { permission_key: "commerce.read" },
      { permission_key: "commerce.read" },
      { permission_key: "pricing.manage" },
      { permission_key: "content.publish" },
      { permission_key: "private.future" },
    ],
    [{ locale: "ja" }, { locale: "en" }],
  ]);
  expect(await repository.context(input)).toEqual({
    schemaVersion: 1,
    outcome: "SUCCESS",
    principal: {
      schemaVersion: 1,
      actorId,
      sessionId,
      expiresAt: session.expires_at,
      authorizedAt: session.now,
    },
    permissions: ["commerce.read", "pricing.manage"],
    localeScopes: ["en", "ja"],
  });
});

test("context never accepts client-supplied permission or actor and validates CSRF before grants", async () => {
  const input = {
    schemaVersion: command.schemaVersion,
    sessionTokenDigest: command.sessionTokenDigest,
    csrfTokenDigest: command.csrfTokenDigest,
  };
  const { repository, query } = setup([[session]]);
  expect(
    await repository.context({ ...input, actorId } as never),
  ).toMatchObject({ code: "INVALID_COMMAND" });
  expect(query).not.toHaveBeenCalled();
  expect(
    await repository.context({
      ...input,
      csrfTokenDigest: sourceHashSchema.parse("c".repeat(64)),
    }),
  ).toMatchObject({ code: "CSRF_INVALID" });
  expect(query).toHaveBeenCalledTimes(1);
});
