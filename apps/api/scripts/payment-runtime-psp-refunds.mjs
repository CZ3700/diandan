import { createHash } from "node:crypto";
import { paymentPortResponseSchema } from "@fan-support/contracts";
const utc = (value) => new Date(value).toISOString();
const fingerprint = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Isolated TEST PSP refund ledger. The caller locks the owning payment before every mutation. */
export async function createTestPspRefunds({
  pool,
  binding,
  transaction,
  loadPayment,
}) {
  await pool.query(`CREATE TABLE IF NOT EXISTS psp_refunds (
    account_id uuid NOT NULL, refund_id uuid NOT NULL, attempt_id uuid NOT NULL,
    command jsonb NOT NULL, fingerprint text NOT NULL, receipt jsonb NOT NULL,
    status text NOT NULL CHECK(status IN ('PROCESSING','SUCCEEDED','FAILED')),
    native_reference text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY(account_id,refund_id), UNIQUE(account_id,native_reference),
    FOREIGN KEY(account_id,attempt_id) REFERENCES psp_payments(account_id,attempt_id))`);
  const failure = (operation, code) =>
    paymentPortResponseSchema.parse({
      schemaVersion: 1,
      operation,
      outcome: "FAILURE",
      error: { schemaVersion: 1, code, recovery: "NONE" },
    });
  const load = async (client, id) =>
    (
      await client.query(
        "SELECT * FROM psp_refunds WHERE account_id=$1::uuid AND refund_id=$2::uuid",
        [binding.providerAccountId, id],
      )
    ).rows[0];
  function event(row, command) {
    return {
      schemaVersion: 1,
      providerAccountId: binding.providerAccountId,
      environment: "TEST",
      providerEventId: `test-event/refund/${row.refund_id}/${row.status}`,
      evidence: {
        kind: "AUTHENTICATED_RECONCILE",
        auditLogId: command.auditLogId,
      },
      occurredAt: utc(row.updated_at),
      association: {
        status: "MATCHED",
        paymentAttemptId: row.attempt_id,
        externalReference: row.command.externalReference,
      },
      eventType: "REFUND_STATUS",
      refundReference: row.command.refundReference,
      status: row.status,
      amountMinor: row.command.amountMinor,
      currency: row.command.currency,
      ...(row.status === "SUCCEEDED"
        ? {
            transaction: {
              type: "REFUND",
              providerReference: row.native_reference,
            },
          }
        : {}),
    };
  }
  return {
    async execute(client, command, payment) {
      const operation = command.operation;
      const prior = await load(client, command.refundId);
      if (operation === "REFUND_PAYMENT") {
        if (prior)
          return prior.fingerprint === fingerprint(command)
            ? prior.receipt
            : failure(operation, "IDEMPOTENCY_CONFLICT");
        if (
          payment.status !== "SUCCEEDED" ||
          !payment.capture_reference ||
          command.currency !== payment.command.currency ||
          command.amountMinor < 1
        )
          return failure(operation, "PROVIDER_DECLINED");
        const occupied = (
          await client.query(
            "SELECT coalesce(sum((command->>'amountMinor')::bigint),0)::text amount FROM psp_refunds WHERE account_id=$1::uuid AND attempt_id=$2::uuid AND status<>'FAILED'",
            [binding.providerAccountId, payment.attempt_id],
          )
        ).rows[0].amount;
        if (
          BigInt(occupied) + BigInt(command.amountMinor) >
          BigInt(payment.command.amountMinor)
        )
          return failure(operation, "PROVIDER_DECLINED");
        const at = (await client.query("SELECT clock_timestamp() AS at"))
          .rows[0].at;
        const response = paymentPortResponseSchema.parse({
          schemaVersion: 1,
          operation,
          outcome: "SUCCESS",
          value: {
            providerAccountId: binding.providerAccountId,
            environment: "TEST",
            refundId: command.refundId,
            paymentAttemptId: payment.attempt_id,
            status: "PROCESSING",
            refundReference: command.refundReference,
            amountMinor: command.amountMinor,
            currency: command.currency,
            observedAt: utc(at),
          },
        });
        await client.query(
          "INSERT INTO psp_refunds(account_id,refund_id,attempt_id,command,fingerprint,receipt,status,native_reference,created_at,updated_at) VALUES($1::uuid,$2::uuid,$3::uuid,$4::jsonb,$5,$6::jsonb,'PROCESSING',$7,$8::timestamptz,$8::timestamptz)",
          [
            binding.providerAccountId,
            command.refundId,
            payment.attempt_id,
            JSON.stringify(command),
            fingerprint(command),
            JSON.stringify(response),
            `test-native-refund/${command.refundId}`,
            at,
          ],
        );
        return response;
      }
      if (
        !prior ||
        [
          "paymentAttemptId",
          "externalReference",
          "refundReference",
          "amountMinor",
          "currency",
          "idempotencyKey",
        ].some((key) => prior.command[key] !== command[key])
      )
        return failure(operation, "REFUND_NOT_FOUND");
      return paymentPortResponseSchema.parse({
        schemaVersion: 1,
        operation,
        outcome: "SUCCESS",
        value: {
          refundId: command.refundId,
          idempotencyKey: command.idempotencyKey,
          event: event(prior, command),
        },
      });
    },
    async settleRefund(refundId, status) {
      if (
        !/^[a-f\d-]{36}$/iu.test(refundId) ||
        !["SUCCEEDED", "FAILED"].includes(status)
      )
        throw new TypeError("Invalid TEST refund settlement");
      return transaction(async (client) => {
        const hint = await load(client, refundId);
        if (!hint) throw new TypeError("Unknown TEST refund");
        await loadPayment(client, hint.attempt_id, true);
        const row = await load(client, refundId);
        if (row.status === status) return;
        if (row.status !== "PROCESSING")
          throw new TypeError("TEST refund terminal outcome is immutable");
        await client.query(
          "UPDATE psp_refunds SET status=$3,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 microsecond') WHERE account_id=$1::uuid AND refund_id=$2::uuid",
          [binding.providerAccountId, refundId, status],
        );
      });
    },
    async readRefundWebhook(refundId) {
      if (typeof refundId !== "string" || !/^[a-f\d-]{36}$/iu.test(refundId))
        throw new TypeError("Invalid TEST refund webhook");
      const row = await load(pool, refundId);
      if (!row) throw new TypeError("Unknown TEST refund");
      return {
        event_id: `test-webhook/refund/${row.refund_id}/${row.status}`,
        created_at: utc(row.updated_at),
        resource: {
          kind: "refund",
          payment_reference: row.command.externalReference,
          refund_reference: row.command.refundReference,
          state: row.status.toLowerCase(),
          amount_minor: row.command.amountMinor,
          currency: row.command.currency,
          ...(row.status === "SUCCEEDED"
            ? {
                transaction: {
                  kind: "refund",
                  reference: row.native_reference,
                },
              }
            : {}),
        },
      };
    },
  };
}
