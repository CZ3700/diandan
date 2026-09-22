import { describe, expect, it } from "vitest";
const contract = await import("./admin-exceptions.js").catch(() => undefined);
const id = "a0000000-b000-4000-8000-000000000001";
const target = { kind: "WEBHOOK", id, consumerKey: null };
const replay = {
  schemaVersion: 1,
  action: "REPLAY_WEBHOOK",
  target,
  expectedVersion: "a".repeat(64),
  reasonCode: "RETRY_AFTER_REPAIR",
  confirmed: true,
  idempotencyKey: "exception-replay-command-001",
};
describe("exception operations boundary", () => {
  it("binds a confirmed recovery to its original source and snapshot", () => {
    expect(contract).toBeDefined();
    const schema = contract!.adminExceptionsCommandSchema;
    expect(schema.parse(replay)).toEqual(replay);
    for (const command of [
      { ...replay, confirmed: false },
      { ...replay, expectedVersion: undefined },
      { ...replay, target: { ...target, kind: "PAYMENT" } },
      { ...replay, target: { ...target, consumerKey: "different-consumer" } },
      { ...replay, rawBody: "private webhook content" },
      { ...replay, reasonCode: "private free text" },
    ])
      expect(schema.safeParse(command).success).toBe(false);
  });
  it("canonicalizes source UUIDs before command hashing", () => {
    expect(contract).toBeDefined();
    expect(
      contract!.adminExceptionsCommandSchema.parse({
        ...replay,
        target: { ...target, id: id.toUpperCase() },
      }),
    ).toEqual(replay);
  });
  it("requires the original consumer only for a dead-letter operation", () => {
    expect(contract).toBeDefined();
    const command = {
      ...replay,
      action: "RETRY_DEAD_LETTER",
      target: {
        ...target,
        kind: "DEAD_LETTER",
        consumerKey: "order-notifications-v1",
      },
    };
    expect(
      contract!.adminExceptionsCommandSchema.safeParse(command).success,
    ).toBe(true);
    expect(
      contract!.adminExceptionsCommandSchema.safeParse({
        ...command,
        target: { ...command.target, consumerKey: null },
      }).success,
    ).toBe(false);
  });
  it("rejects a receipt for another source or operation", () => {
    expect(contract).toBeDefined();
    const command = contract!.adminExceptionsCommandSchema.parse(replay);
    const receipt = {
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "MUTATION",
      action: "REPLAY_WEBHOOK",
      target,
      operationId: id,
      replayed: true,
    };
    expect(contract!.adminExceptionsResponseMatches(command, receipt)).toBe(
      true,
    );
    expect(
      contract!.adminExceptionsResponseMatches(command, {
        ...receipt,
        action: "RETRY_NOTIFICATION",
      }),
    ).toBe(false);
    expect(
      contract!.adminExceptionsResponseMatches(command, {
        ...receipt,
        target: { ...target, id: "a0000000-b000-4000-8000-000000000002" },
      }),
    ).toBe(false);
  });
  it("rejects sensitive detail fields and unknown error strings", () => {
    expect(contract).toBeDefined();
    const schema = contract!.adminExceptionsResponseSchema;
    expect(
      schema.safeParse({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "TEMPORARY_UNAVAILABLE",
        rawBody: "private",
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "database password leaked",
      }).success,
    ).toBe(false);
  });
});
