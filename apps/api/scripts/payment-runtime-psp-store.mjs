import { URL } from "node:url";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { Pool } from "pg";
import { createTestPspRefunds } from "./payment-runtime-psp-refunds.mjs";
import { createTestPspDisputes } from "./payment-runtime-psp-disputes.mjs";
import {
  paymentPortCommandSchema,
  paymentPortResponseSchema,
  paymentRuntimeProviderBindingSchema,
  paymentRuntimeOriginSchema,
} from "@fan-support/contracts";

const sha = (value) => createHash("sha256").update(value).digest("hex");
function failure(operation, code) {
  return paymentPortResponseSchema.parse({
    schemaVersion: 1,
    operation,
    outcome: "FAILURE",
    error: { schemaVersion: 1, code, recovery: "NONE" },
  });
}
const utc = (value) => new Date(value).toISOString();

/** Only this separate TEST PSP database owns provider acceptance; API process memory cannot fabricate it. */
export async function createPaymentTestPspStore(options) {
  if (
    !/^p404_psp_[a-f0-9]{32}$/u.test(options.database.database ?? "") ||
    !Buffer.isBuffer(options.secret) ||
    options.secret.length !== 32
  )
    throw new TypeError("Invalid isolated TEST PSP database");
  const binding = paymentRuntimeProviderBindingSchema.parse(options.binding);
  const origin = paymentRuntimeOriginSchema.parse(options.origin),
    returnOrigin = paymentRuntimeOriginSchema.parse(options.returnOrigin);
  if (binding.environment !== "TEST")
    throw new TypeError("Persistent PSP is TEST only");
  const pool = new Pool(options.database);
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS psp_payments (
    account_id uuid NOT NULL, attempt_id uuid NOT NULL, command jsonb NOT NULL, fingerprint text NOT NULL,
    external_reference text NOT NULL, provider_locale text NOT NULL, fallback_used boolean NOT NULL,
    status text NOT NULL CHECK(status IN ('REQUIRES_ACTION','PROCESSING','SUCCEEDED','FAILED','CANCELED','EXPIRED')),
    cancellation_fingerprint text, capture_reference text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY(account_id,attempt_id), UNIQUE(account_id,external_reference), UNIQUE(account_id,capture_reference));
    CREATE TABLE IF NOT EXISTS psp_calls (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, account_id uuid NOT NULL, attempt_id uuid, operation text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT clock_timestamp())`);
  } catch (error) {
    await pool.end();
    throw error;
  }
  const hostedToken = (attemptId) =>
    createHmac("sha256", options.secret)
      .update(`hosted:${binding.providerAccountId}:${attemptId}`)
      .digest("base64url");
  function authorized(attemptId, token) {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(token))
      return false;
    return timingSafeEqual(
      Buffer.from(token),
      Buffer.from(hostedToken(attemptId)),
    );
  }
  function observe(row) {
    return {
      status: row.status,
      externalReference: row.external_reference,
      providerLocale: row.provider_locale,
      fallbackUsed: row.fallback_used,
      observedAt: utc(row.updated_at),
      providerAccountId: binding.providerAccountId,
      environment: "TEST",
      attemptId: row.attempt_id,
      ...(row.status === "REQUIRES_ACTION"
        ? {
            action: {
              schemaVersion: 1,
              type: "REDIRECT",
              url: `${origin}/hosted/${row.attempt_id}/${hostedToken(row.attempt_id)}`,
            },
          }
        : {}),
    };
  }
  async function load(client, attemptId, lock = false) {
    return (
      await client.query(
        `SELECT * FROM psp_payments WHERE account_id=$1::uuid AND attempt_id=$2::uuid${lock ? " FOR UPDATE" : ""}`,
        [binding.providerAccountId, attemptId],
      )
    ).rows[0];
  }
  async function transaction(work) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const value = await work(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  async function execute(input) {
    const parsed = paymentPortCommandSchema.safeParse(input);
    if (!parsed.success) throw new TypeError("Invalid TEST PSP command");
    const command = parsed.data,
      operation = command.operation;
    if (
      command.environment !== "TEST" ||
      command.providerAccountId !== binding.providerAccountId
    )
      return failure(operation, "CONFIGURATION_ERROR");
    if (operation === "VERIFY_AND_PARSE_WEBHOOK")
      return failure(operation, "UNSUPPORTED_EVENT");
    if (
      operation === "CREATE_PAYMENT" &&
      (new URL(command.returnUrl).origin !== returnOrigin ||
        new URL(command.cancelUrl).origin !== returnOrigin)
    )
      return failure(operation, "CONFIGURATION_ERROR");
    return transaction(async (client) => {
      await client.query(
        "INSERT INTO psp_calls(account_id,attempt_id,operation) VALUES($1::uuid,$2::uuid,$3)",
        [
          binding.providerAccountId,
          "attemptId" in command
            ? command.attemptId
            : "paymentAttemptId" in command
              ? command.paymentAttemptId
              : null,
          operation,
        ],
      );
      if (operation === "GET_CAPABILITIES") {
        if (!command.supportedActionTypes.includes("REDIRECT"))
          return failure(operation, "CAPABILITY_UNAVAILABLE");
        return paymentPortResponseSchema.parse({
          schemaVersion: 1,
          operation,
          outcome: "SUCCESS",
          value: {
            capabilities: [
              {
                schemaVersion: 1,
                id: binding.providerAccountId,
                paymentMethod: "fake_card",
                displayName: "TEST payment",
                market: command.market,
                country: command.country,
                currency: command.currency,
                minimumAmountMinor: 1,
                maximumAmountMinor: Number.MAX_SAFE_INTEGER,
                actionTypes: ["REDIRECT"],
                available: true,
              },
            ],
          },
        });
      }
      if (operation === "CREATE_PAYMENT") {
        if (command.paymentMethod !== "fake_card")
          return failure(operation, "CAPABILITY_UNAVAILABLE");
        const fingerprint = sha(JSON.stringify(command)),
          locale = binding.localeMapping[command.requestedLocale];
        await client.query(
          "INSERT INTO psp_payments(account_id,attempt_id,command,fingerprint,external_reference,provider_locale,fallback_used,status) VALUES($1::uuid,$2::uuid,$3::jsonb,$4,$5,$6,$7,'REQUIRES_ACTION') ON CONFLICT(account_id,attempt_id) DO NOTHING",
          [
            binding.providerAccountId,
            command.attemptId,
            JSON.stringify(command),
            fingerprint,
            `test-payment/${command.attemptId}`,
            locale.providerLocale,
            locale.fallbackUsed,
          ],
        );
        const row = await load(client, command.attemptId, true);
        if (row.fingerprint !== fingerprint)
          return failure(operation, "IDEMPOTENCY_CONFLICT");
        return paymentPortResponseSchema.parse({
          schemaVersion: 1,
          operation,
          outcome: "SUCCESS",
          value: {
            ...observe(row),
            orderId: row.command.orderId,
            amountMinor: row.command.amountMinor,
            currency: row.command.currency,
          },
        });
      }
      let row = await load(
        client,
        "paymentAttemptId" in command
          ? command.paymentAttemptId
          : command.attemptId,
        true,
      );
      if (
        !row ||
        ("externalReference" in command &&
          command.externalReference !== undefined &&
          command.externalReference !== row.external_reference)
      )
        return failure(operation, "PAYMENT_NOT_FOUND");
      if (operation === "REFUND_PAYMENT" || operation === "RECONCILE_REFUND")
        return refunds.execute(client, command, row);
      if (operation === "GET_PAYMENT")
        return paymentPortResponseSchema.parse({
          schemaVersion: 1,
          operation,
          outcome: "SUCCESS",
          value: observe(row),
        });
      if (operation === "CANCEL_PAYMENT") {
        const fingerprint = sha(JSON.stringify(command));
        if (
          row.cancellation_fingerprint &&
          row.cancellation_fingerprint !== fingerprint
        )
          return failure(operation, "IDEMPOTENCY_CONFLICT");
        if (!row.cancellation_fingerprint) {
          if (!["REQUIRES_ACTION", "PROCESSING"].includes(row.status))
            return failure(operation, "PROVIDER_DECLINED");
          await client.query(
            "UPDATE psp_payments SET status='CANCELED',cancellation_fingerprint=$3,updated_at=GREATEST(clock_timestamp(),updated_at) WHERE account_id=$1::uuid AND attempt_id=$2::uuid",
            [binding.providerAccountId, command.attemptId, fingerprint],
          );
          row = await load(client, command.attemptId);
        }
        return paymentPortResponseSchema.parse({
          schemaVersion: 1,
          operation,
          outcome: "SUCCESS",
          value: observe(row),
        });
      }
      if (operation === "RECONCILE_PAYMENT") {
        if (
          command.amountMinor !== row.command.amountMinor ||
          command.currency !== row.command.currency
        )
          return failure(operation, "PAYMENT_NOT_FOUND");
        return paymentPortResponseSchema.parse({
          schemaVersion: 1,
          operation,
          outcome: "SUCCESS",
          value: {
            event: {
              schemaVersion: 1,
              providerAccountId: binding.providerAccountId,
              environment: "TEST",
              providerEventId: `test-event/${row.attempt_id}/${row.status}`,
              evidence: {
                kind: "AUTHENTICATED_RECONCILE",
                auditLogId: command.auditLogId,
              },
              occurredAt: utc(row.updated_at),
              association: {
                status: "MATCHED",
                paymentAttemptId: row.attempt_id,
                externalReference: row.external_reference,
              },
              eventType: "PAYMENT_STATUS",
              status: row.status,
              amountMinor: row.command.amountMinor,
              currency: row.command.currency,
              ...(row.capture_reference
                ? {
                    transaction: {
                      type: "CAPTURE",
                      providerReference: row.capture_reference,
                    },
                  }
                : {}),
            },
          },
        });
      }
      return failure(operation, "CAPABILITY_UNAVAILABLE");
    });
  }
  async function readHosted(attemptId, token) {
    if (!/^[a-f\d-]{36}$/iu.test(attemptId) || !authorized(attemptId, token))
      throw new TypeError("Invalid hosted TEST payment");
    const row = await load(pool, attemptId);
    if (!row) throw new TypeError("Missing hosted TEST payment");
    return {
      status: row.status,
      amountMinor: row.command.amountMinor,
      currency: row.command.currency,
      returnUrl: row.command.returnUrl,
      cancelUrl: row.command.cancelUrl,
      providerLocale: row.provider_locale,
    };
  }
  async function settleHosted(attemptId, token, status) {
    if (
      !authorized(attemptId, token) ||
      !["SUCCEEDED", "FAILED", "CANCELED", "EXPIRED", "PROCESSING"].includes(
        status,
      )
    )
      throw new TypeError("Invalid hosted TEST outcome");
    return transaction(async (client) => {
      const row = await load(client, attemptId, true);
      if (!row) throw new TypeError("Missing hosted TEST payment");
      if (row.status === status) return;
      if (["REQUIRES_ACTION", "PROCESSING"].includes(row.status))
        await client.query(
          "UPDATE psp_payments SET status=$3,capture_reference=CASE WHEN $3='SUCCEEDED' THEN $4 ELSE NULL END,updated_at=GREATEST(clock_timestamp(),updated_at) WHERE account_id=$1::uuid AND attempt_id=$2::uuid",
          [
            binding.providerAccountId,
            attemptId,
            status,
            `test-native-capture/${attemptId}`,
          ],
        );
      else if (row.status !== status)
        throw new TypeError("TEST PSP terminal outcome is immutable");
    });
  }
  const refunds = await createTestPspRefunds({
    pool,
    binding,
    transaction,
    loadPayment: load,
  });
  const disputes = await createTestPspDisputes({
    pool,
    binding,
    transaction,
    loadPayment: load,
  });
  let closed;
  return {
    execute,
    readHosted,
    settleHosted,
    settleRefund: refunds.settleRefund,
    readRefundWebhook: refunds.readRefundWebhook,
    settleDispute: disputes.settleDispute,
    readDisputeWebhook: disputes.readDisputeWebhook,
    async readHostedAction(attemptId) {
      if (typeof attemptId !== "string" || !/^[a-f\d-]{36}$/iu.test(attemptId))
        throw new TypeError("Invalid owned TEST hosted read");
      const row = await load(pool, attemptId);
      if (!row) throw new TypeError("Missing owned TEST payment");
      return observe(row).action ?? null;
    },
    async readWebhook(attemptId) {
      if (typeof attemptId !== "string" || !/^[a-f\d-]{36}$/iu.test(attemptId))
        throw new TypeError("Invalid TEST webhook payment");
      const row = await load(pool, attemptId);
      if (!row) throw new TypeError("Missing TEST webhook payment");
      return {
        event_id: `test-webhook/${row.attempt_id}/${row.status}`,
        created_at: utc(row.updated_at),
        resource: {
          kind: "payment",
          payment_reference: row.external_reference,
          state:
            row.status === "SUCCEEDED" ? "captured" : row.status.toLowerCase(),
          amount_minor: row.command.amountMinor,
          currency: row.command.currency,
          ...(row.capture_reference
            ? {
                transaction: {
                  kind: "capture",
                  reference: row.capture_reference,
                },
              }
            : {}),
        },
      };
    },
    async counts() {
      const {
        rows: [row],
      } = await pool.query(
        "SELECT (SELECT count(*)::integer FROM psp_payments WHERE account_id=$1::uuid) AS payments,(SELECT count(*)::integer FROM psp_payments WHERE account_id=$1::uuid AND capture_reference IS NOT NULL) AS captures,(SELECT count(*)::integer FROM psp_calls WHERE account_id=$1::uuid AND operation='CREATE_PAYMENT') AS create_calls,(SELECT count(*)::integer FROM psp_calls WHERE account_id=$1::uuid AND operation='RECONCILE_PAYMENT') AS reconcile_calls",
        [binding.providerAccountId],
      );
      return {
        payments: row.payments,
        captures: row.captures,
        createCalls: row.create_calls,
        reconcileCalls: row.reconcile_calls,
        ...(
          await pool.query(
            "SELECT (SELECT count(*)::integer FROM psp_refunds WHERE account_id=$1::uuid) AS refunds,(SELECT count(*)::integer FROM psp_refunds WHERE account_id=$1::uuid AND status='SUCCEEDED') AS refunded,(SELECT count(*)::integer FROM psp_calls WHERE account_id=$1::uuid AND operation='REFUND_PAYMENT') AS \"refundCalls\",(SELECT count(*)::integer FROM psp_calls WHERE account_id=$1::uuid AND operation='RECONCILE_REFUND') AS \"reconcileRefundCalls\",(SELECT count(*)::integer FROM psp_calls WHERE account_id=$1::uuid AND operation='CANCEL_PAYMENT') AS \"cancelCalls\"",
            [binding.providerAccountId],
          )
        ).rows[0],
      };
    },
    close: () => (closed ??= pool.end()),
  };
}
