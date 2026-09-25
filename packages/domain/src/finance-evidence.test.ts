import { describe, expect, it } from "vitest";
const module = await import("./finance-evidence.js").catch(() => undefined);
const account = "10000000-0000-4000-8000-000000000001",
  attempt = "10000000-0000-4000-8000-000000000002",
  inbox = "10000000-0000-4000-8000-000000000003";
function input(
  kind: "REFUND" | "DISPUTE",
  currentStatus: string,
  status: string,
) {
  const eventType = kind === "REFUND" ? "REFUND_STATUS" : "DISPUTE_STATUS";
  return {
    schemaVersion: 1,
    kind,
    currentStatus,
    target: {
      paymentAttemptId: attempt,
      providerAccountId: account,
      environment: "TEST",
      externalReference: "pay_test",
      providerReference: "correlation_test",
      amountMinor: 250,
      capturedAmountMinor: 1000,
      currency: "USD",
    },
    event: {
      schemaVersion: 1,
      eventType,
      providerAccountId: account,
      environment: "TEST",
      providerEventId: "evt_test",
      evidence: { kind: "VERIFIED_WEBHOOK", webhookInboxId: inbox },
      occurredAt: "2026-09-22T00:00:00Z",
      association: {
        status: "MATCHED",
        paymentAttemptId: attempt,
        externalReference: "pay_test",
      },
      [kind === "REFUND" ? "refundReference" : "disputeReference"]:
        "correlation_test",
      status,
      amountMinor: 250,
      currency: "USD",
      ...(kind === "REFUND" && status === "SUCCEEDED"
        ? {
            transaction: {
              type: "REFUND",
              providerReference: "psp_refund_test",
            },
          }
        : {}),
    },
  };
}
const decide = (value: unknown) => {
  expect(module?.decideFinanceEvidence).toBeTypeOf("function");
  return module!.decideFinanceEvidence(value);
};
describe("financial evidence decisions", () => {
  it("keeps early refund evidence pending until durable submission", () => {
    expect(decide(input("REFUND", "REQUESTED", "SUCCEEDED"))).toMatchObject({
      decision: "WAIT",
      targetStatus: null,
    });
  });
  it.each(["SUBMITTING", "PROCESSING", "UNKNOWN"])(
    "applies trusted refund success from %s",
    (current) => {
      expect(decide(input("REFUND", current, "SUCCEEDED"))).toMatchObject({
        decision: "APPLY",
        targetStatus: "SUCCEEDED",
      });
    },
  );
  it("requires native refund transaction identity for successful evidence", () => {
    const value = input("REFUND", "UNKNOWN", "SUCCEEDED");
    delete value.event.transaction;
    expect(decide(value)).toMatchObject({
      decision: "REVIEW",
      reasonCode: "REFUND_TRANSACTION_REQUIRED",
    });
  });
  it("ignores stale progress and repeated terminal evidence without reopening or settling twice", () => {
    for (const current of ["SUCCEEDED", "FAILED"]) {
      expect(decide(input("REFUND", current, "PROCESSING"))).toMatchObject({
        decision: "IGNORE",
      });
      expect(decide(input("REFUND", current, current))).toMatchObject({
        decision: "IGNORE",
      });
    }
    for (const current of ["WON", "LOST"]) {
      expect(decide(input("DISPUTE", current, "OPEN"))).toMatchObject({
        decision: "IGNORE",
      });
      expect(decide(input("DISPUTE", current, current))).toMatchObject({
        decision: "IGNORE",
      });
    }
  });
  it("sends conflicting financial terminal evidence to review", () => {
    for (const [kind, current, next] of [
      ["REFUND", "SUCCEEDED", "FAILED"],
      ["REFUND", "FAILED", "SUCCEEDED"],
      ["DISPUTE", "WON", "LOST"],
      ["DISPUTE", "LOST", "WON"],
    ] as const)
      expect(decide(input(kind, current, next))).toMatchObject({
        decision: "REVIEW",
        targetStatus: null,
      });
  });
  it.each(["WON", "LOST"])(
    "accepts first dispute terminal %s without inventing OPEN",
    (next) => {
      expect(decide(input("DISPUTE", "NONE", next))).toMatchObject({
        decision: "APPLY",
        targetStatus: next,
      });
    },
  );
  it("rechecks every identity and amount before even accepting a duplicate", () => {
    const original = input("REFUND", "SUCCEEDED", "SUCCEEDED");
    for (const patch of [
      { providerAccountId: inbox },
      { environment: "LIVE" },
      { currency: "EUR" },
      { amountMinor: 251 },
      { refundReference: "wrong" },
      {
        association: {
          status: "MATCHED",
          paymentAttemptId: inbox,
          externalReference: "pay_test",
        },
      },
      {
        association: {
          status: "MATCHED",
          paymentAttemptId: attempt,
          externalReference: "wrong",
        },
      },
      { association: { status: "UNMATCHED", externalReference: "pay_test" } },
    ])
      expect(
        decide({ ...original, event: { ...original.event, ...patch } }),
      ).toMatchObject({ decision: "REVIEW" });
    expect(
      decide({ ...original, event: input("DISPUTE", "NONE", "OPEN").event }),
    ).toMatchObject({ decision: "REVIEW" });
  });
  it("rejects invalid input, amount beyond capture, and provider-invented platform states", () => {
    expect(decide(null)).toMatchObject({
      decision: "REVIEW",
      reasonCode: "FINANCE_EVIDENCE_INVALID",
    });
    const original = input("REFUND", "UNKNOWN", "PROCESSING");
    expect(
      decide({
        ...original,
        target: { ...original.target, capturedAmountMinor: 249 },
      }),
    ).toMatchObject({ decision: "REVIEW" });
    for (const next of ["REQUESTED", "SUBMITTING", "UNKNOWN"])
      expect(decide(input("REFUND", "PROCESSING", next))).toMatchObject({
        decision: "REVIEW",
      });
  });
  it("accepts progress and explicit failure, including recovery from UNKNOWN", () => {
    for (const current of ["SUBMITTING", "UNKNOWN"]) {
      for (const next of ["PROCESSING", "FAILED"])
        expect(decide(input("REFUND", current, next))).toMatchObject({
          decision: "APPLY",
          targetStatus: next,
        });
    }
    expect(decide(input("REFUND", "PROCESSING", "PROCESSING"))).toMatchObject({
      decision: "IGNORE",
    });
    expect(decide(input("DISPUTE", "NONE", "OPEN"))).toMatchObject({
      decision: "APPLY",
    });
    expect(decide(input("DISPUTE", "OPEN", "WON"))).toMatchObject({
      decision: "APPLY",
    });
  });
  it("aggregates all disputes conservatively and serializably", () => {
    expect(module?.projectFinanceDisputeStatus).toBeTypeOf("function");
    for (const [statuses, status] of [
      [[], "NONE"],
      [["WON"], "WON"],
      [["WON", "OPEN"], "OPEN"],
      [["OPEN", "LOST", "WON"], "LOST"],
    ] as const) {
      const result = module!.projectFinanceDisputeStatus({
        schemaVersion: 1,
        statuses: [...statuses],
      });
      expect(result).toEqual({ schemaVersion: 1, status });
      expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    }
    expect(() =>
      module!.projectFinanceDisputeStatus({
        schemaVersion: 1,
        statuses: ["NONE"],
      }),
    ).toThrow();
  });
});
