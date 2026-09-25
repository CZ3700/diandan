import { expect, test, vi } from "vitest";
import { giftCommerceWriteCommandSchema } from "@fan-support/contracts";
import { createGiftCommerceCatalogRepository } from "./gift-commerce-gift-repository.js";
import {
  computeGiftRevisionProfileHash,
  readGiftRevisionProfile,
} from "./gift-commerce-gift-profile.js";
const giftId = "76189879-4be8-4fe2-a583-09926fdbb93e";
const revisionId = "8dfca214-ea76-4ffb-9f4e-4b027861bbfa";
const actorId = "a6e9ee96-65e7-4725-a777-734b5f27748d";
const time = "2026-09-07T08:00:00.000001Z";
const scope = {
  trackOperation: async <T>(work: () => Promise<T>) => work(),
  markRollbackOnly: () => undefined,
};
const command = giftCommerceWriteCommandSchema.parse({
  schemaVersion: 1,
  requestId: revisionId,
  principal: {
    schemaVersion: 1,
    actorId,
    sessionId: revisionId,
    authorizedAt: time,
    expiresAt: "2026-09-07T09:00:00Z",
  },
  command: {
    schemaVersion: 1,
    action: "SET_GIFT_STATUS",
    giftId,
    status: "paused",
    expectedBaseVersion: 2,
    reasonCode: "OPERATOR_PAUSE",
    idempotencyKey: "gift-operator-pause-001",
  },
});
test("catalog rejects malformed and foreign subsystem commands before SQL", async () => {
  const query = vi.fn();
  const repo = createGiftCommerceCatalogRepository(
    { query, release: () => undefined },
    scope,
  );
  expect(await repo.write({ schemaVersion: 1 } as never)).toMatchObject({
    code: "INVALID_COMMAND",
  });
  expect(
    await repo.read({ schemaVersion: 1, action: "CONTEXT" }),
  ).toMatchObject({ code: "INVALID_COMMAND" });
  expect(query).not.toHaveBeenCalled();
});
test("missing gift and stale base versions produce no business write", async () => {
  for (const prior of [null, { id: giftId, version: 3, status: "active" }]) {
    const query = vi.fn(async (sql: string) => ({
      rows: sql.includes("FOR UPDATE") && prior ? [{ gift: prior }] : [],
    }));
    const repo = createGiftCommerceCatalogRepository(
      { query, release: () => undefined },
      scope,
    );
    expect(await repo.write(command)).toMatchObject({
      code: prior ? "STALE_VERSION" : "NOT_FOUND",
    });
    expect(
      query.mock.calls.some(([sql]) =>
        /^\s*(INSERT|UPDATE|DELETE)\b/u.test(sql),
      ),
    ).toBe(false);
  }
});
test("profile hashes normalize only typed UUID and timestamp presentation, preserving microseconds and classification", () => {
  const profile = {
    schemaVersion: 1 as const,
    giftId,
    giftRevisionId: revisionId,
    giftKind: "WISH" as const,
    createdBy: actorId,
    createdAt: time,
  };
  const hash = computeGiftRevisionProfileHash(profile);
  expect(hash).toMatch(/^[a-f0-9]{64}$/u);
  expect(
    computeGiftRevisionProfileHash({
      ...profile,
      giftId: giftId.toUpperCase(),
      createdAt: "2026-09-07T16:00:00.000001+08:00",
    }),
  ).toBe(hash);
  expect(
    computeGiftRevisionProfileHash({
      ...profile,
      createdAt: "2026-09-07T08:00:00.000002Z",
    }),
  ).not.toBe(hash);
  expect(
    computeGiftRevisionProfileHash({ ...profile, giftKind: "PHYSICAL" }),
  ).not.toBe(hash);
});
test("a required profile can never downgrade to legacy when evidence is absent", async () => {
  const query = vi.fn(async (sql: string) => ({
    rows: sql.includes("gift_revisions")
      ? [{ id: revisionId, gift_id: giftId, profile_version: 2 }]
      : [],
  }));
  await expect(
    readGiftRevisionProfile(
      { query, release: () => undefined },
      giftId,
      revisionId,
    ),
  ).rejects.toThrow("Invalid gift profile evidence");
});
test("only a persisted migration marker establishes an old revision as legacy", async () => {
  const query = vi.fn(async () => ({
    rows: [{ id: revisionId, gift_id: giftId, profile_version: 1 }],
  }));
  expect(
    await readGiftRevisionProfile(
      { query, release: () => undefined },
      giftId,
      revisionId,
    ),
  ).toEqual({ kind: "LEGACY", giftRevisionId: revisionId });
});
