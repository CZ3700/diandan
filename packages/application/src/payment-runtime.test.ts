import { describe, expect, it, vi } from "vitest";
import { PaymentRuntimeRepositoryError } from "@fan-support/persistence-port";
import { paymentHarness } from "./payment-runtime.harness.js";

const load = () => import("./payment-runtime.js").catch(() => null);
async function harness() {
  const h = await paymentHarness();
  const module = await load();
  const app = module?.createPaymentRuntimeUseCases(h.dependencies);
  expect(app).toBeDefined();
  return { ...h, app: app! };
}
describe("persistent payment application orchestration", () => {
  it("recovers a lost create action only after authenticated reconcile and encrypts it outside the transaction", async () => {
    const h = await harness();
    h.setOutcome("UNKNOWN");
    h.setReconcileStatus("REQUIRES_ACTION");
    await h.app.create(h.create, h.context);
    const attempt = h.state().current.currentAttempt!;
    const record = vi.spyOn(h.repo, "recordReconcile");
    const result = await h.app.recover(h.recover(attempt.id), h.freshContext());
    expect(h.provider.getPayment).toHaveBeenCalledExactlyOnceWith({
      schemaVersion: 1,
      operation: "GET_PAYMENT",
      providerAccountId: attempt.providerAccountId,
      environment: attempt.environment,
      attemptId: attempt.id,
      externalReference: `fake/payment/${attempt.id}`,
    });
    expect(h.keys.encryptEnvelope).toHaveBeenCalledOnce();
    expect(record.mock.calls[0]?.[0]).toMatchObject({
      action: {
        type: "REDIRECT",
        ciphertext: expect.stringMatching(/^enc:v1:/u),
      },
    });
    expect(result).toMatchObject({
      outcome: "SUCCESS",
      attempt: {
        id: attempt.id,
        status: "REQUIRES_ACTION",
        action: { type: "REDIRECT" },
      },
    });
    expect(JSON.stringify(h.state())).not.toContain(
      "https://payments.example.test/continue/",
    );
    expect(h.provider.createPayment).toHaveBeenCalledOnce();
  });
  it("defers a malformed recovered action without recording it or issuing another create", async () => {
    const h = await harness();
    h.setOutcome("UNKNOWN");
    h.setReconcileStatus("REQUIRES_ACTION");
    await h.app.create(h.create, h.context);
    const attempt = h.state().current.currentAttempt!;
    h.provider.getPayment.mockResolvedValueOnce({
      schemaVersion: 1,
      operation: "GET_PAYMENT",
      outcome: "SUCCESS",
      value: {},
    });
    const record = vi.spyOn(h.repo, "recordReconcile");
    const deferred = vi.spyOn(h.repo, "deferRecovery");
    expect(
      await h.app.recover(h.recover(attempt.id), h.freshContext()),
    ).toMatchObject({ attempt: { status: "UNKNOWN" } });
    expect(deferred).toHaveBeenCalledOnce();
    expect(record).not.toHaveBeenCalled();
    expect(h.keys.encryptEnvelope).not.toHaveBeenCalled();
    expect(h.provider.createPayment).toHaveBeenCalledOnce();
  });
  it("never looks up an action before the reconcile financial and audit identity matches", async () => {
    const h = await harness();
    h.setOutcome("UNKNOWN");
    h.setReconcileStatus("REQUIRES_ACTION");
    await h.app.create(h.create, h.context);
    const attempt = h.state().current.currentAttempt!;
    const original = h.provider.reconcilePayment.getMockImplementation()!;
    h.provider.reconcilePayment.mockImplementationOnce(async (command) => {
      const response = await original(command);
      const value = response.value as { event: Record<string, unknown> };
      return {
        ...response,
        value: { event: { ...value.event, amountMinor: 1 } },
      };
    });
    const deferred = vi.spyOn(h.repo, "deferRecovery");
    expect(
      await h.app.recover(h.recover(attempt.id), h.freshContext()),
    ).toMatchObject({ attempt: { status: "UNKNOWN" } });
    expect(deferred).toHaveBeenCalledOnce();
    expect(h.provider.getPayment).not.toHaveBeenCalled();
    expect(h.keys.encryptEnvelope).not.toHaveBeenCalled();
  });
  it("does not replace an already stored action on a repeated REQUIRES_ACTION observation", async () => {
    const h = await harness();
    await h.app.create(h.create, h.context);
    h.setReconcileStatus("REQUIRES_ACTION");
    const before = structuredClone(h.state().current.currentAttempt!);
    expect(
      await h.app.recover(h.recover(before.id), h.freshContext()),
    ).toMatchObject({ attempt: { status: "REQUIRES_ACTION" } });
    expect(h.provider.getPayment).not.toHaveBeenCalled();
    expect(h.keys.encryptEnvelope).toHaveBeenCalledOnce();
    expect(h.state().current.currentAttempt?.action).toEqual(before.action);
  });
  it.each(["GET", "KMS"])(
    "defers %s failure during lost-action recovery without recording a state transition",
    async (boundary) => {
      const h = await harness();
      h.setOutcome("UNKNOWN");
      h.setReconcileStatus("REQUIRES_ACTION");
      await h.app.create(h.create, h.context);
      const attempt = h.state().current.currentAttempt!;
      if (boundary === "GET")
        h.provider.getPayment.mockRejectedValueOnce(
          new Error("Injected GET failure"),
        );
      else
        h.keys.encryptEnvelope.mockRejectedValueOnce(
          new Error("Injected KMS failure"),
        );
      const record = vi.spyOn(h.repo, "recordReconcile");
      const deferred = vi.spyOn(h.repo, "deferRecovery");
      expect(
        await h.app.recover(h.recover(attempt.id), h.freshContext()),
      ).toMatchObject({ attempt: { status: "UNKNOWN" } });
      expect(deferred).toHaveBeenCalledOnce();
      expect(record).not.toHaveBeenCalled();
      expect(h.provider.createPayment).toHaveBeenCalledOnce();
    },
  );
  it("safely rereads a concurrent permanent receipt without dispatching the live claim twice", async () => {
    const h = await harness();
    const earlierContext = structuredClone(h.state().current);
    const first = await h.app.create(h.create, h.context);
    vi.spyOn(h.repo, "findCreateReceipt").mockResolvedValueOnce(null);
    vi.spyOn(h.repo, "loadContext").mockResolvedValueOnce(earlierContext);
    vi.spyOn(h.repo, "beginCreate").mockRejectedValueOnce(
      new PaymentRuntimeRepositoryError("STALE_CLAIM"),
    );
    const second = await h.app.create(h.create, h.context);
    expect(second).toMatchObject({ action: "REPLAYED", outcome: "SUCCESS" });
    if (
      first.outcome === "SUCCESS" &&
      "attempt" in first &&
      second.outcome === "SUCCESS" &&
      "attempt" in second
    )
      expect(second.attempt?.id).toBe(first.attempt?.id);
    expect(h.provider.createPayment).toHaveBeenCalledOnce();
  });
  it("accepts equivalent UUID casing without weakening session ownership", async () => {
    const h = await harness();
    expect(
      await h.app.capabilities(
        {
          schemaVersion: 1,
          operation: "READ_PAYMENT_CAPABILITIES",
          checkoutSessionId: h.create.checkoutSessionId.toUpperCase(),
          presentationLocale: "en",
          supportedActionTypes: ["REDIRECT"],
        },
        h.context,
      ),
    ).toMatchObject({ action: "CAPABILITIES" });
  });
  it("freezes the existing order and encrypts its hosted action between transactions", async () => {
    const h = await harness();
    const result = await h.app.create(h.create, h.context);
    expect(result).toMatchObject({
      outcome: "SUCCESS",
      action: "CREATED",
      attempt: { status: "REQUIRES_ACTION", environment: "TEST" },
    });
    const command = h.provider.createPayment.mock.calls[0]?.[0];
    expect(command?.orderId).toBe(h.state().current.checkout.receipt.orderId);
    expect(command?.amountMinor).toBe(
      h.state().current.checkout.observation.quote.amount.totalAmountMinor,
    );
    expect(command?.merchantReference).toBe(command?.attemptId);
    expect(command?.providerIdempotencyKey).toBe(command?.attemptId);
    expect(h.keys.encryptEnvelope).toHaveBeenCalledOnce();
    expect(JSON.stringify(h.state())).not.toContain(
      "https://payments.example.test/continue/",
    );
  });
  it("replays the permanent identity before checking changed routing and rejects changed bodies", async () => {
    const h = await harness();
    const first = await h.app.create(h.create, h.context);
    h.state().current.routing = null;
    const replay = await h.app.create(h.create, h.context);
    expect(replay).toMatchObject({ outcome: "SUCCESS", action: "REPLAYED" });
    if (
      first.outcome === "SUCCESS" &&
      "attempt" in first &&
      replay.outcome === "SUCCESS" &&
      "attempt" in replay
    )
      expect(replay.attempt?.id).toBe(first.attempt?.id);
    expect(h.provider.createPayment).toHaveBeenCalledOnce();
    expect(
      await h.app.create({ ...h.create, country: "CA" }, h.context),
    ).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("keeps accepted-but-lost results UNKNOWN and only reconciles the same attempt without an external ID", async () => {
    const h = await harness();
    h.setOutcome("UNKNOWN");
    const created = await h.app.create(h.create, h.context);
    expect(created).toMatchObject({
      outcome: "SUCCESS",
      attempt: { status: "UNKNOWN", canRetry: false },
    });
    const attempt = h.state().current.currentAttempt!;
    expect(await h.app.create(h.create, h.freshContext())).toMatchObject({
      code: "PAYMENT_IN_PROGRESS",
    });
    const recovered = await h.app.recover(
      h.recover(attempt.id),
      h.freshContext(),
    );
    expect(recovered).toMatchObject({
      outcome: "SUCCESS",
      attempt: { id: attempt.id, status: "PROCESSING" },
    });
    expect(h.provider.createPayment).toHaveBeenCalledOnce();
    expect(h.provider.reconcilePayment).toHaveBeenCalledOnce();
    expect(
      h.provider.reconcilePayment.mock.calls[0]?.[0].externalReference,
    ).toBeUndefined();
  });
  it("recovers a first-transaction commit with a lost response through the original frozen create", async () => {
    const h = await harness();
    h.loseFirstCommit();
    expect(await h.app.create(h.create, h.context)).toMatchObject({
      code: "TRANSACTION_OUTCOME_UNKNOWN",
    });
    expect(h.provider.createPayment).not.toHaveBeenCalled();
    const current = await h.app.current(
      { schemaVersion: 1, operation: "READ_CURRENT_CHECKOUT" },
      h.context,
    );
    expect(current).toMatchObject({
      action: "CURRENT",
      attempt: { status: "CREATED" },
    });
    const prior = h.state().current.currentAttempt!;
    expect(
      await h.app.recover(h.recover(prior.id), h.freshContext()),
    ).toMatchObject({ attempt: { id: prior.id, status: "REQUIRES_ACTION" } });
    expect(h.provider.createPayment).toHaveBeenCalledOnce();
    expect(Object.keys(h.state().attempts)).toHaveLength(1);
  });
  it("returns only owned state and pure GET never invokes create, getPayment or reconcile", async () => {
    const h = await harness();
    await h.app.create(h.create, h.context);
    const attempt = h.state().current.currentAttempt!;
    await h.app.read(h.read(attempt.id), h.context);
    await h.app.current(
      { schemaVersion: 1, operation: "READ_CURRENT_CHECKOUT" },
      h.context,
    );
    expect(h.provider.createPayment).toHaveBeenCalledOnce();
    expect(h.provider.reconcilePayment).not.toHaveBeenCalled();
    expect(h.provider.getPayment).not.toHaveBeenCalled();
    expect(
      await h.app.read(h.read(attempt.id), {
        ...h.context,
        accesses: [{ ...h.context.accesses[0], tokenDigest: "b".repeat(64) }],
      }),
    ).toMatchObject({ code: "INVALID_ACCESS" });
  });
  it("blocks expired checkout and validates adapter capability before persisting an attempt", async () => {
    const h = await harness();
    h.state().current.readiness = "RECHECKOUT_REQUIRED";
    expect(await h.app.create(h.create, h.context)).toMatchObject({
      code: "RECHECKOUT_REQUIRED",
    });
    expect(h.provider.createPayment).not.toHaveBeenCalled();
    expect(Object.keys(h.state().attempts)).toHaveLength(0);
    expect(
      await h.app.create({ ...h.create, amountMinor: 1 }, h.context),
    ).toMatchObject({ code: "INVALID_COMMAND" });
  });
  it("recovers a durable UNKNOWN without any browser and preserves the original create count", async () => {
    const h = await harness();
    h.setOutcome("UNKNOWN");
    await h.app.create(h.create, h.context);
    expect(await h.app.recoverNext()).toEqual({
      schemaVersion: 1,
      outcome: "SUCCESS",
      processed: true,
    });
    expect(h.provider.createPayment).toHaveBeenCalledOnce();
    expect(h.provider.reconcilePayment).toHaveBeenCalledOnce();
    expect(h.state().current.currentAttempt?.status).toBe("PROCESSING");
  });
  it("fails uncertain when the provider response is malformed instead of retrying the charge", async () => {
    const h = await harness();
    h.setOutcome("MALFORMED");
    expect(await h.app.create(h.create, h.context)).toMatchObject({
      attempt: {
        status: "UNKNOWN",
        recovery: "RECONCILE_REQUIRED",
        canRetry: false,
      },
    });
    expect(h.provider.createPayment).toHaveBeenCalledOnce();
  });
  it("does not infer country or call the provider until an explicit eligible country is selected", async () => {
    const h = await harness();
    expect(
      await h.app.capabilities(
        {
          schemaVersion: 1,
          operation: "READ_PAYMENT_CAPABILITIES",
          checkoutSessionId: h.create.checkoutSessionId,
          presentationLocale: "ja",
          supportedActionTypes: ["REDIRECT"],
        },
        h.context,
      ),
    ).toMatchObject({
      action: "CAPABILITIES",
      capabilities: { country: null, countries: ["US"], capabilities: [] },
    });
    expect(h.provider.getCapabilities).not.toHaveBeenCalled();
    expect(
      h.state().current.checkout.observation.consent.presentationLocale,
    ).toBe("en");
  });
  it("rechecks authorization and version after decrypting an action, withholding a stale result", async () => {
    const h = await harness();
    await h.app.create(h.create, h.context);
    const attempt = h.state().current.currentAttempt!;
    h.afterDecrypt(() => {
      attempt.version++;
      h.state().attempts[attempt.id]!.version = attempt.version;
    });
    const result = await h.app.read(h.read(attempt.id), h.context);
    expect(result).toMatchObject({
      outcome: "FAILURE",
      code: "VERSION_CONFLICT",
    });
    expect(JSON.stringify(result)).not.toContain(
      "https://payments.example.test",
    );
  });
});
