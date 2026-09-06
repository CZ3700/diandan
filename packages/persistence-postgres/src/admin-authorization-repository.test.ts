import { describe, expect, test, vi } from "vitest";
import { sourceHashSchema } from "@fan-support/contracts";
import { createAdminAuthorizationRepository } from "./admin-authorization-repository.js";

const actorId = "10000000-0000-4000-8000-000000000001";
const sessionId = "10000000-0000-4000-8000-000000000002";
const command = {
  schemaVersion: 1 as const,
  sessionTokenDigest: sourceHashSchema.parse("a".repeat(64)),
  csrfTokenDigest: sourceHashSchema.parse("b".repeat(64)),
  permission: "content.translation.review" as const,
  locales: ["ja" as const],
};
const session = {
  actor_id: actorId,
  session_id: sessionId,
  csrf_token_digest: Buffer.from(command.csrfTokenDigest, "hex"),
  expires_at: "2026-09-06T12:00:00.000000Z",
  now: "2026-09-06T11:00:00.000000Z",
};
function harness(rows: unknown[][] = []) {
  const query = vi.fn(async () => ({ rows: rows.shift() ?? [] }));
  return {
    query,
    repository: createAdminAuthorizationRepository(
      { query, release: () => undefined },
      { markRollbackOnly: vi.fn(), trackOperation: async (work) => work() },
    ),
  };
}
describe("canonical admin authorization", () => {
  test("preserves database microseconds in authorization and session expiry", async () => {
    const precise = {
      ...session,
      expires_at: "2026-09-06T12:00:00.123456Z",
      now: "2026-09-06T11:59:30.000789Z",
    };
    const { repository } = harness([
      [precise],
      [{ role_id: actorId }],
      [{ locale: "ja" }],
    ]);
    expect(await repository.authorize(command)).toMatchObject({
      outcome: "SUCCESS",
      principal: {
        expiresAt: precise.expires_at,
        authorizedAt: precise.now,
      },
    });
  });
  test("rejects an invalid digest or invented permission before accessing storage", async () => {
    const { query, repository } = harness();
    expect(
      await repository.authorize({
        ...command,
        permission: "content.admin",
      } as never),
    ).toMatchObject({ code: "INVALID_COMMAND" });
    expect(
      await repository.authorize({
        ...command,
        sessionTokenDigest: "token",
      } as never),
    ).toMatchObject({ code: "INVALID_COMMAND" });
    expect(query).not.toHaveBeenCalled();
  });
  test("does not expose whether an absent, expired, revoked, suspended or non-MFA session exists", async () => {
    expect(await harness().repository.authorize(command)).toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });
  test("checks CSRF before returning permission data", async () => {
    const { query, repository } = harness([[session]]);
    expect(
      await repository.authorize({
        ...command,
        csrfTokenDigest: sourceHashSchema.parse("c".repeat(64)),
      }),
    ).toMatchObject({ code: "CSRF_INVALID" });
    expect(query).toHaveBeenCalledTimes(1);
  });
  test("does not infer a role or a locale grant", async () => {
    expect(
      await harness([[session]]).repository.authorize(command),
    ).toMatchObject({ code: "FORBIDDEN" });
    expect(
      await harness([
        [session],
        [{ role_id: actorId }],
        [],
      ]).repository.authorize(command),
    ).toMatchObject({ code: "FORBIDDEN" });
  });
  test("returns only canonical principal data after both grants are present", async () => {
    const { query, repository } = harness([
      [session],
      [{ role_id: actorId }],
      [{ locale: "ja" }],
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
    expect(query.mock.calls.flat().join(" ")).not.toContain(
      command.sessionTokenDigest,
    );
  });
  test("uses no language grant for ordinary read permission", async () => {
    const { query, repository } = harness([[session], [{ role_id: actorId }]]);
    expect(
      await repository.authorize({
        ...command,
        permission: "content.read",
        locales: [],
      }),
    ).toMatchObject({ outcome: "SUCCESS" });
    expect(query).toHaveBeenCalledTimes(2);
  });
  test("normalizes infrastructure failures", async () => {
    const repository = createAdminAuthorizationRepository(
      {
        query: async () => {
          throw new Error("secret connection url");
        },
        release: () => undefined,
      },
      { markRollbackOnly: vi.fn(), trackOperation: async (work) => work() },
    );
    await expect(repository.authorize(command)).rejects.toMatchObject({
      name: "PersistenceTransactionFailureError",
    });
  });
});
