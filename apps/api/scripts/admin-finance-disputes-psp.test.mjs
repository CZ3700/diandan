import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { withEphemeralPostgres } from "@fan-support/persistence-postgres";
const implementation = await import("./payment-runtime-psp-disputes.mjs").catch(
  () => undefined,
);
test("persistent TEST dispute evidence retains native identity, skipped states and restart history", async () => {
  assert.equal(typeof implementation?.createTestPspDisputes, "function");
  await withEphemeralPostgres(async (database) => {
    const pool = new Pool(database),
      account = randomUUID(),
      attempt = randomUUID(),
      other = randomUUID();
    const binding = { providerAccountId: account, environment: "TEST" };
    try {
      await pool.query(
        "CREATE TABLE psp_payments(account_id uuid,attempt_id uuid,command jsonb,external_reference text,status text,capture_reference text,PRIMARY KEY(account_id,attempt_id))",
      );
      await pool.query(
        "INSERT INTO psp_payments VALUES($1,$2,$3,'payment_test','SUCCEEDED','capture_test'),($1,$4,$3,'other_payment_test','PROCESSING',NULL)",
        [
          account,
          attempt,
          JSON.stringify({ amountMinor: 1000, currency: "USD" }),
          other,
        ],
      );
      const transaction = async (work) => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await work(client);
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      };
      const loadPayment = async (client, attemptId, lock = false) =>
        (
          await client.query(
            `SELECT * FROM psp_payments WHERE account_id=$1 AND attempt_id=$2${lock ? " FOR UPDATE" : ""}`,
            [account, attemptId],
          )
        ).rows[0];
      const options = { pool, binding, transaction, loadPayment };
      let store = await implementation.createTestPspDisputes(options);
      const disputeId = randomUUID(),
        command = {
          attemptId: attempt,
          disputeId,
          status: "OPEN",
          amountMinor: 250,
        };
      const [first, duplicate] = await Promise.all([
        store.settleDispute(command),
        store.settleDispute(command),
      ]);
      assert.deepEqual(first, duplicate);
      assert.equal(first.resource.kind, "dispute");
      assert.equal(first.resource.state, "open");
      assert.equal(first.resource.amount_minor, 250);
      assert.equal(first.resource.transaction.kind, "chargeback");
      await assert.rejects(
        store.settleDispute({ ...command, amountMinor: 251 }),
        /identity/u,
      );
      await assert.rejects(
        store.settleDispute({ ...command, attemptId: other }),
        /capture|identity/u,
      );
      await assert.rejects(
        store.settleDispute({
          ...command,
          disputeId: randomUUID(),
          amountMinor: 1001,
        }),
        /capture/u,
      );
      await assert.rejects(
        store.settleDispute({
          ...command,
          disputeId: randomUUID(),
          amountMinor: 0,
        }),
        /Invalid/u,
      );
      await assert.rejects(
        store.settleDispute({
          ...command,
          disputeId: randomUUID(),
          amountMinor: 0.5,
        }),
        /Invalid/u,
      );
      await assert.rejects(
        store.settleDispute({ ...command, disputeId: "bad" }),
        /Invalid/u,
      );
      const lost = await store.settleDispute({ ...command, status: "LOST" });
      assert.equal(
        lost.resource.transaction.reference,
        first.resource.transaction.reference,
      );
      assert.notEqual(lost.event_id, first.event_id);
      assert.deepEqual(
        await store.settleDispute({ ...command, status: "LOST" }),
        lost,
      );
      for (const status of ["OPEN", "WON"])
        await assert.rejects(
          store.settleDispute({ ...command, status }),
          /terminal/u,
        );
      store = await implementation.createTestPspDisputes(options);
      assert.deepEqual(await store.readDisputeWebhook(disputeId), lost);
      const won = await store.settleDispute({
        ...command,
        disputeId: randomUUID(),
        status: "WON",
      });
      assert.equal(won.resource.state, "won");
      assert.equal(won.resource.transaction, undefined);
      const terminal = await store.settleDispute({
        ...command,
        disputeId: randomUUID(),
        status: "LOST",
      });
      assert.equal(terminal.resource.state, "lost");
      assert.equal(
        first.resource.state,
        "open",
        "earlier raw evidence remains available to deliver late",
      );
      const foreign = await implementation.createTestPspDisputes({
        ...options,
        binding: { ...binding, providerAccountId: randomUUID() },
      });
      await assert.rejects(foreign.readDisputeWebhook(disputeId), /Unknown/u);
      assert.equal(
        Number(
          (await pool.query("SELECT count(*) n FROM psp_disputes")).rows[0].n,
        ),
        3,
      );
    } finally {
      await pool.end();
    }
  });
});
test("dispute fixture cannot run against a LIVE binding", async () => {
  assert.equal(typeof implementation?.createTestPspDisputes, "function");
  await assert.rejects(
    implementation.createTestPspDisputes({
      binding: { environment: "LIVE" },
      pool: { query: () => assert.fail("must reject before SQL") },
    }),
    /TEST/u,
  );
});
