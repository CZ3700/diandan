import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as contracts from "./index.js";

const id = "00000000-0000-4000-8000-000000000001";
function schema(name: string): z.ZodType {
  const value = (contracts as unknown as Record<string, unknown>)[name];
  expect(value, name).toBeInstanceOf(z.ZodType);
  return value as z.ZodType;
}
describe("order payment evidence application boundary", () => {
  it("accepts only durable evidence references and processing trace", () => {
    const command = {
      schemaVersion: 1,
      providerEventId: id,
      requestId: id,
      correlationId: id,
      taskName: "order-payment-application",
    };
    const contract = schema("orderPaymentApplyCommandSchema");
    expect(contract.safeParse(command).success).toBe(true);
    for (const injected of [
      { status: "SUCCEEDED" },
      { amountMinor: 1 },
      { orderId: id },
      { token: "secret" },
    ])
      expect(contract.safeParse({ ...command, ...injected }).success).toBe(
        false,
      );
    expect(contract.safeParse({ ...command, schemaVersion: 2 }).success).toBe(
      false,
    );
  });
  it("keeps retryable unmatched observations distinct from permanent receipts", () => {
    const contract = schema("orderPaymentApplyResultSchema");
    expect(
      contract.safeParse({
        schemaVersion: 1,
        decision: "UNMATCHED",
        providerEventId: id,
        reason: "EXTERNAL_REFERENCE_NOT_BOUND",
      }).success,
    ).toBe(true);
    expect(
      contract.safeParse({
        schemaVersion: 1,
        decision: "UNMATCHED",
        providerEventId: id,
        reason: "EXTERNAL_REFERENCE_NOT_BOUND",
        receiptId: id,
      }).success,
    ).toBe(false);
    const paid = {
      schemaVersion: 1,
      decision: "APPLIED",
      providerEventId: id,
      receiptId: id,
      attemptId: id,
      orderId: id,
      outcome: "PAID_REVIEW",
    };
    expect(contract.safeParse(paid).success).toBe(true);
    expect(contract.safeParse({ ...paid, outcome: "DELIVERED" }).success).toBe(
      false,
    );
    expect(contract.safeParse({ ...paid, attemptId: null }).success).toBe(
      false,
    );
  });
  it("bounds pending scans and rejects duplicate references", () => {
    const command = schema("orderPaymentListPendingCommandSchema");
    expect(command.safeParse({ schemaVersion: 1, limit: 100 }).success).toBe(
      true,
    );
    for (const limit of [0, 101, 1.5])
      expect(command.safeParse({ schemaVersion: 1, limit }).success).toBe(
        false,
      );
    const result = schema("orderPaymentPendingEventsSchema");
    expect(
      result.safeParse({ schemaVersion: 1, providerEventIds: [id] }).success,
    ).toBe(true);
    expect(
      result.safeParse({ schemaVersion: 1, providerEventIds: [id, id] })
        .success,
    ).toBe(false);
  });
});

const eventId = "11111111-1111-4111-8111-111111111111";
const attemptId = "22222222-2222-4222-8222-222222222222";
const orderId = "33333333-3333-4333-8333-333333333333";
const receiptId = "44444444-4444-4444-8444-444444444444";
const requestId = "abcdefab-cdef-4abc-8def-abcdefabcdef";
const correlationId = "fedcbafe-dcba-4fed-8cba-fedcbafedcba";
const command = {
  schemaVersion: 1,
  providerEventId: eventId,
  requestId,
  correlationId,
  taskName: "order-payment-application",
};
const applied = {
  schemaVersion: 1,
  decision: "APPLIED",
  providerEventId: eventId,
  receiptId,
  attemptId,
  orderId,
  outcome: "PAID",
};

describe("strict order payment application contracts", () => {
  it("rejects candidate payloads, browser return claims and injected authority", () => {
    const contract = schema("orderPaymentApplyCommandSchema");
    for (const injected of [
      { providerEvent: { status: "SUCCEEDED", amountMinor: 100 } },
      { candidate: { authenticated: true } },
      { evidence: { kind: "VERIFIED_WEBHOOK", webhookInboxId: id } },
      { authority: "PROVIDER_EVIDENCE" },
      { success: true },
      { externalReference: "provider-payment" },
      { currency: "USD" },
      { sessionToken: "test-only-token" },
      { fanMessage: "test-only-private-content" },
      { email: "test@example.invalid" },
    ]) {
      expect(contract.safeParse({ ...command, ...injected }).success).toBe(
        false,
      );
    }
  });

  it("preserves independent canonical request and correlation IDs", () => {
    const contract = schema("orderPaymentApplyCommandSchema");
    expect(contract.parse(command)).toEqual(command);
    for (const field of ["requestId", "correlationId"] as const) {
      for (const invalid of [
        undefined,
        null,
        "",
        "trace",
        requestId.toUpperCase(),
        ` ${requestId}`,
      ]) {
        expect(
          contract.safeParse({ ...command, [field]: invalid }).success,
        ).toBe(false);
      }
    }
  });

  it("requires an actual task label without whitespace, controls or provider text", () => {
    const contract = schema("orderPaymentApplyCommandSchema");
    expect(
      contract.safeParse({ ...command, taskName: "a".repeat(128) }).success,
    ).toBe(true);
    for (const taskName of [
      "",
      "a".repeat(129),
      "OrderPayment",
      "order payment",
      "order-payment\n",
      "order__payment",
      "https://provider.invalid",
    ]) {
      expect(contract.safeParse({ ...command, taskName }).success).toBe(false);
    }
  });

  it.each(["REVIEW", "IGNORED"])(
    "%s binds attempt and order together",
    (decision) => {
      const contract = schema("orderPaymentApplyResultSchema");
      const result = {
        schemaVersion: 1,
        decision,
        providerEventId: eventId,
        receiptId,
        reasonCode: "EVIDENCE_REQUIRES_REVIEW",
      };
      expect(
        contract.safeParse({ ...result, attemptId, orderId }).success,
      ).toBe(true);
      expect(
        contract.safeParse({ ...result, attemptId: null, orderId: null })
          .success,
      ).toBe(true);
      expect(
        contract.safeParse({ ...result, attemptId: null, orderId }).success,
      ).toBe(false);
      expect(
        contract.safeParse({ ...result, attemptId, orderId: null }).success,
      ).toBe(false);
    },
  );

  it.each(["APPLIED", "ALREADY_APPLIED"])(
    "%s requires a durable receipt and full aggregate identity",
    (decision) => {
      const contract = schema("orderPaymentApplyResultSchema");
      for (const outcome of ["PAID", "PAID_REVIEW", "FAILED_RELEASED"]) {
        expect(
          contract.safeParse({ ...applied, decision, outcome }).success,
        ).toBe(true);
      }
      for (const field of [
        "receiptId",
        "providerEventId",
        "attemptId",
        "orderId",
        "outcome",
      ]) {
        expect(
          contract.safeParse({ ...applied, decision, [field]: undefined })
            .success,
        ).toBe(false);
      }
      for (const outcome of [
        "SUCCEEDED",
        "PROCESSING",
        "REFUNDED",
        "DELIVERED",
      ]) {
        expect(
          contract.safeParse({ ...applied, decision, outcome }).success,
        ).toBe(false);
      }
    },
  );

  it("keeps unmatched evidence retryable without permanent or financial fields", () => {
    const contract = schema("orderPaymentApplyResultSchema");
    const unmatched = {
      schemaVersion: 1,
      decision: "UNMATCHED",
      providerEventId: eventId,
      reason: "EXTERNAL_REFERENCE_NOT_BOUND",
    };
    for (const extra of [
      { receiptId },
      { attemptId },
      { orderId },
      { outcome: "PAID" },
      { retryable: false },
      { reasonCode: "IGNORED" },
    ]) {
      expect(contract.safeParse({ ...unmatched, ...extra }).success).toBe(
        false,
      );
    }
    expect(
      contract.safeParse({ ...unmatched, reason: "INVALID_SIGNATURE" }).success,
    ).toBe(false);
  });

  it("rejects fields borrowed from another decision and unexpected versions", () => {
    const contract = schema("orderPaymentApplyResultSchema");
    const review = {
      schemaVersion: 1,
      decision: "REVIEW",
      providerEventId: eventId,
      receiptId,
      attemptId,
      orderId,
      reasonCode: "EVIDENCE_REQUIRES_REVIEW",
    };
    for (const result of [
      { ...applied, reasonCode: "EVIDENCE_REQUIRES_REVIEW" },
      { ...review, outcome: "PAID" },
      { ...review, reasonCode: "Provider says paid" },
      { ...review, reasonCode: "BAD\n" },
      { ...review, reasonCode: "A".repeat(129) },
      { ...applied, decision: "SUCCESS" },
      { ...applied, schemaVersion: 2 },
      { ...applied, response: { token: "test-only" } },
    ])
      expect(contract.safeParse(result).success).toBe(false);
  });

  it("round-trips all reference/result variants as plain JSON without losing facts", () => {
    const values: ReadonlyArray<readonly [z.ZodType, unknown]> = [
      [schema("orderPaymentApplyCommandSchema"), command],
      ...["APPLIED", "ALREADY_APPLIED"].map(
        (decision) =>
          [
            schema("orderPaymentApplyResultSchema"),
            { ...applied, decision },
          ] as const,
      ),
      [
        schema("orderPaymentApplyResultSchema"),
        {
          schemaVersion: 1,
          decision: "UNMATCHED",
          providerEventId: eventId,
          reason: "EXTERNAL_REFERENCE_NOT_BOUND",
        },
      ],
      ...["REVIEW", "IGNORED"].map(
        (decision) =>
          [
            schema("orderPaymentApplyResultSchema"),
            {
              schemaVersion: 1,
              decision,
              providerEventId: eventId,
              receiptId,
              attemptId: null,
              orderId: null,
              reasonCode: "UNSUPPORTED_EVENT",
            },
          ] as const,
      ),
      [
        schema("orderPaymentListPendingCommandSchema"),
        { schemaVersion: 1, limit: 100 },
      ],
      [
        schema("orderPaymentPendingEventsSchema"),
        { schemaVersion: 1, providerEventIds: [eventId] },
      ],
    ];
    for (const [contract, value] of values) {
      const parsed = contract.parse(value);
      expect(JSON.parse(JSON.stringify(parsed))).toEqual(value);
    }
  });

  it("bounds scans without coercion and treats differently cased UUIDs as duplicates", () => {
    const list = schema("orderPaymentListPendingCommandSchema");
    for (const limit of ["1", NaN, Infinity, -1, 101, 1n, null]) {
      expect(list.safeParse({ schemaVersion: 1, limit }).success).toBe(false);
    }
    expect(
      list.safeParse({ schemaVersion: 1, limit: 1, includeApplied: true })
        .success,
    ).toBe(false);
    const pending = schema("orderPaymentPendingEventsSchema");
    const identifiers = Array.from(
      { length: 100 },
      (_, index) =>
        `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
    );
    expect(
      pending.safeParse({ schemaVersion: 1, providerEventIds: [] }).success,
    ).toBe(true);
    expect(
      pending.safeParse({ schemaVersion: 1, providerEventIds: identifiers })
        .success,
    ).toBe(true);
    expect(
      pending.safeParse({
        schemaVersion: 1,
        providerEventIds: [...identifiers, eventId],
      }).success,
    ).toBe(false);
    expect(
      pending.safeParse({
        schemaVersion: 1,
        providerEventIds: [requestId, requestId.toUpperCase()],
      }).success,
    ).toBe(false);
    expect(
      pending.safeParse({
        schemaVersion: 1,
        providerEventIds: [eventId],
        providerEvents: [],
      }).success,
    ).toBe(false);
  });

  it("accounts for every scanned event exactly once, including an empty batch", () => {
    const contract = schema("orderPaymentRunResultSchema");
    const empty = {
      schemaVersion: 1,
      scanned: 0,
      applied: 0,
      replayed: 0,
      unmatched: 0,
      review: 0,
      ignored: 0,
      failed: 0,
    };
    const mixed = {
      schemaVersion: 1,
      scanned: 21,
      applied: 1,
      replayed: 2,
      unmatched: 3,
      review: 4,
      ignored: 5,
      failed: 6,
    };
    for (const value of [
      empty,
      mixed,
      { ...empty, scanned: 100, applied: 100 },
    ]) {
      expect(contract.parse(value)).toEqual(value);
      expect(JSON.parse(JSON.stringify(contract.parse(value)))).toEqual(value);
    }
    expect(contract.safeParse({ ...mixed, scanned: 20 }).success).toBe(false);
    expect(contract.safeParse({ ...mixed, scanned: 22 }).success).toBe(false);
    for (const field of [
      "scanned",
      "applied",
      "replayed",
      "unmatched",
      "review",
      "ignored",
      "failed",
    ]) {
      for (const value of [-1, 0.5, 101, "0", null, undefined, NaN, Infinity]) {
        expect(contract.safeParse({ ...empty, [field]: value }).success).toBe(
          false,
        );
      }
    }
    expect(contract.safeParse({ ...mixed, schemaVersion: 2 }).success).toBe(
      false,
    );
    expect(
      contract.safeParse({
        ...mixed,
        failures: [{ rawProviderMessage: "test-only" }],
      }).success,
    ).toBe(false);
  });
});
