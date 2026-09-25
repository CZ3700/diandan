import { expect, test, vi } from "vitest";
import { sourceHashSchema } from "@fan-support/contracts";
import { createAdminSessionRepository } from "./admin-session-repository.js";
const actorId = "10000000-0000-4000-8000-000000000001";
const command = {
  schemaVersion: 1 as const,
  sessionTokenDigest: sourceHashSchema.parse("a".repeat(64)),
  csrfTokenDigest: sourceHashSchema.parse("b".repeat(64)),
};
const session = {
  actor_id: actorId,
  csrf_token_digest: Buffer.from(command.csrfTokenDigest, "hex"),
};
function setup(rows: unknown[][] = []) {
  const query = vi.fn(async () => ({ rows: rows.shift() ?? [] }));
  return {
    query,
    repository: createAdminSessionRepository(
      { query, release: () => undefined },
      { markRollbackOnly: vi.fn(), trackOperation: async (work) => work() },
    ),
  };
}
test("session view filters unknown capabilities and deduplicates effective grants", async () => {
  const { repository } = setup([
    [session],
    [
      { permission_key: "content.read" },
      { permission_key: "content.read" },
      { permission_key: "private.future.permission" },
      { permission_key: "content.media.upload" },
    ],
    [{ locale: "ja" }, { locale: "en" }],
  ]);
  expect(await repository.read(command)).toEqual({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "ADMIN_SESSION",
    actorId,
    permissions: ["content.read", "content.media.upload"],
    localeScopes: ["en", "ja"],
  });
});
test("valid sessions with no effective privileges receive an empty access view", async () => {
  expect(await setup([[session], [], []]).repository.read(command)).toEqual({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "ADMIN_SESSION",
    actorId,
    permissions: [],
    localeScopes: [],
  });
});
test("absent session and CSRF mismatch cannot read access grants", async () => {
  expect(await setup().repository.read(command)).toMatchObject({
    code: "UNAUTHENTICATED",
  });
  const { query, repository } = setup([[session]]);
  expect(
    await repository.read({
      ...command,
      csrfTokenDigest: sourceHashSchema.parse("c".repeat(64)),
    }),
  ).toMatchObject({ code: "CSRF_INVALID" });
  expect(query).toHaveBeenCalledTimes(1);
});
test("invalid input never reaches PostgreSQL", async () => {
  const { repository, query } = setup();
  expect(await repository.read({ ...command, actorId } as never)).toMatchObject(
    { code: "INVALID_COMMAND" },
  );
  expect(query).not.toHaveBeenCalled();
});
