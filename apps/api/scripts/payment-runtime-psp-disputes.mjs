const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/iu;
const utc = (value) => new Date(value).toISOString();
/** Independent TEST-only PSP dispute ledger. Stored evidence can be delivered repeatedly or out of order by the protocol fixture. */
export async function createTestPspDisputes({
  pool,
  binding,
  transaction,
  loadPayment,
}) {
  if (binding?.environment !== "TEST")
    throw new TypeError("Dispute ledger is TEST only");
  await pool.query(`CREATE TABLE IF NOT EXISTS psp_disputes(
  account_id uuid NOT NULL,dispute_id uuid NOT NULL,attempt_id uuid NOT NULL,
  external_reference text NOT NULL,amount_minor bigint NOT NULL CHECK(amount_minor>0 AND amount_minor<=9007199254740991),currency text NOT NULL,
  status text NOT NULL CHECK(status IN('OPEN','WON','LOST')),native_reference text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(account_id,dispute_id),UNIQUE(account_id,native_reference),FOREIGN KEY(account_id,attempt_id) REFERENCES psp_payments(account_id,attempt_id))`);
  const load = async (client, disputeId) =>
    (
      await client.query(
        "SELECT * FROM psp_disputes WHERE account_id=$1::uuid AND dispute_id=$2::uuid",
        [binding.providerAccountId, disputeId],
      )
    ).rows[0];
  function webhook(row) {
    return {
      event_id: `test-webhook/dispute/${row.dispute_id}/${row.status}`,
      created_at: utc(row.updated_at),
      resource: {
        kind: "dispute",
        payment_reference: row.external_reference,
        dispute_reference: row.dispute_id,
        state: row.status.toLowerCase(),
        amount_minor: Number(row.amount_minor),
        currency: row.currency,
        ...(row.status === "WON"
          ? {}
          : {
              transaction: {
                kind: "chargeback",
                reference: row.native_reference,
              },
            }),
      },
    };
  }
  return Object.freeze({
    async settleDispute(command) {
      if (
        !command ||
        Object.keys(command).some(
          (key) =>
            !["attemptId", "disputeId", "status", "amountMinor"].includes(key),
        ) ||
        !uuid.test(command.attemptId) ||
        !uuid.test(command.disputeId) ||
        !["OPEN", "WON", "LOST"].includes(command.status) ||
        !Number.isSafeInteger(command.amountMinor) ||
        command.amountMinor <= 0
      )
        throw new TypeError("Invalid TEST dispute settlement");
      return transaction(async (client) => {
        const payment = await loadPayment(client, command.attemptId, true);
        if (
          !payment ||
          payment.account_id !== binding.providerAccountId ||
          payment.status !== "SUCCEEDED" ||
          !payment.capture_reference ||
          command.amountMinor > payment.command.amountMinor
        )
          throw new TypeError("TEST dispute requires a matching capture");
        const prior = await load(client, command.disputeId);
        if (prior) {
          if (
            prior.attempt_id !== command.attemptId ||
            Number(prior.amount_minor) !== command.amountMinor ||
            prior.currency !== payment.command.currency ||
            prior.external_reference !== payment.external_reference
          )
            throw new TypeError("TEST dispute identity is immutable");
          if (prior.status === command.status) return webhook(prior);
          if (prior.status !== "OPEN")
            throw new TypeError("TEST dispute terminal outcome is immutable");
          await client.query(
            "UPDATE psp_disputes SET status=$3,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 microsecond') WHERE account_id=$1::uuid AND dispute_id=$2::uuid",
            [binding.providerAccountId, command.disputeId, command.status],
          );
        } else {
          const occupied = (
            await client.query(
              "SELECT coalesce(sum(amount_minor),0)::text amount FROM psp_disputes WHERE account_id=$1::uuid AND attempt_id=$2::uuid AND status<>'WON'",
              [binding.providerAccountId, command.attemptId],
            )
          ).rows[0].amount;
          if (
            command.status !== "WON" &&
            BigInt(occupied) + BigInt(command.amountMinor) >
              BigInt(payment.command.amountMinor)
          )
            throw new TypeError("TEST disputes exceed capture");
          await client.query(
            "INSERT INTO psp_disputes(account_id,dispute_id,attempt_id,external_reference,amount_minor,currency,status,native_reference) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8)",
            [
              binding.providerAccountId,
              command.disputeId,
              command.attemptId,
              payment.external_reference,
              command.amountMinor,
              payment.command.currency,
              command.status,
              `test-native-chargeback/${command.disputeId}`,
            ],
          );
        }
        return webhook(await load(client, command.disputeId));
      });
    },
    async readDisputeWebhook(disputeId) {
      if (typeof disputeId !== "string" || !uuid.test(disputeId))
        throw new TypeError("Invalid TEST dispute webhook");
      const row = await load(pool, disputeId);
      if (!row) throw new TypeError("Unknown TEST dispute");
      return webhook(row);
    },
  });
}
