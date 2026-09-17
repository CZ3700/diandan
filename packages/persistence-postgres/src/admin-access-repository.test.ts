import { adminAccessRevokeCommandSchema } from "@fan-support/contracts";
import { randomUUID } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import { createAdminAccessRepository } from "./admin-access-repository.js";

function harness(rows: unknown[][] = []) {
  const query = vi.fn(async () => ({ rows: rows.shift() ?? [] }));
  return {
    query,
    repository: createAdminAccessRepository(
      { query, release: () => undefined },
      { markRollbackOnly: vi.fn(), trackOperation: async (work) => work() },
    ),
  };
}
const revoke = adminAccessRevokeCommandSchema.parse({
  schemaVersion: 1 as const,
  requestId: randomUUID(),
  sessionTokenDigest: "a".repeat(64),
  csrfTokenDigest: "b".repeat(64),
  revokeAll: false,
});
describe("admin access trust boundary", () => {
  test("rejects malformed commands before touching storage", async () => {
    const { query, repository } = harness();
    for (const method of [
      "create",
      "claim",
      "complete",
      "reject",
      "revoke",
    ] as const) {
      expect(await repository[method]({ schemaVersion: 1 } as never)).toEqual({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "INVALID_COMMAND",
      });
    }
    expect(query).not.toHaveBeenCalled();
  });
  test("short stored CSRF fails safely without mutating session or audit", async () => {
    const { query, repository } = harness([
      [{ admin_identity_id: randomUUID() }],
      [{ id: randomUUID() }],
      [
        {
          id: randomUUID(),
          csrf_token_digest: Buffer.alloc(1),
          revoked_at: null,
          live: true,
        },
      ],
    ]);
    expect(await repository.revoke(revoke)).toMatchObject({
      code: "CSRF_INVALID",
    });
    expect(query).toHaveBeenCalledTimes(3);
  });
  test("an already-revoked current session still needs correct CSRF", async () => {
    const { repository } = harness([
      [{ admin_identity_id: randomUUID() }],
      [{ id: randomUUID() }],
      [
        {
          csrf_token_digest: Buffer.alloc(32),
          revoked_at: new Date(),
          live: true,
        },
      ],
    ]);
    expect(await repository.revoke(revoke)).toMatchObject({
      code: "CSRF_INVALID",
    });
  });
  test.each([false, true])(
    "expired matching-CSRF session current/all logout boundary: all=%s",
    async (revokeAll) => {
      const identityId = randomUUID();
      const { query, repository } = harness([
        [{ admin_identity_id: identityId }],
        [{ id: identityId, status: "SUSPENDED" }],
        [
          {
            id: randomUUID(),
            admin_identity_id: identityId,
            csrf_token_digest: Buffer.from(revoke.csrfTokenDigest, "hex"),
            revoked_at: null,
            live: false,
          },
        ],
        [{ now: "2026-09-18T01:00:00.000000Z", live: false }],
        [{ id: randomUUID() }],
      ]);
      expect(await repository.revoke({ ...revoke, revokeAll })).toMatchObject(
        revokeAll ? { code: "UNAUTHENTICATED" } : { kind: "LOGGED_OUT" },
      );
      expect(query).toHaveBeenCalledTimes(revokeAll ? 4 : 6);
    },
  );
  test("driver failures cross the safe transaction boundary without credentials", async () => {
    const { query, repository } = harness();
    query.mockRejectedValueOnce(
      Object.assign(new Error("private credential detail"), { code: "40001" }),
    );
    await expect(repository.revoke(revoke)).rejects.toMatchObject({
      name: "PersistenceTransactionFailureError",
      failure: { error: { code: "TRANSACTION_ABORTED" } },
    });
    try {
      await repository.revoke({
        ...revoke,
        sessionTokenDigest: "invalid",
      } as never);
    } catch {
      expect.unreachable();
    }
  });
});
