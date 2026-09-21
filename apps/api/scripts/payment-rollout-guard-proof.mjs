import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createPostgresPersistenceWithPoolFactory } from "../../../packages/persistence-postgres/dist/postgres-persistence.js";

/** TEST only: corrupt a read projection, then optionally a single admission result.
 * Every authority row, write, transaction and deferred PostgreSQL constraint remains real.
 */
export async function verifyRolloutGuards({
  context,
  excluded,
  capability,
  healthPolicies,
  check,
  paymentClient,
}) {
  const results = [];
  const snapshot = async () =>
    (
      await context.client.query(
        `SELECT o.version::int, o.payment_status, o.current_payment_attempt_id,
          session.status AS checkout_status,
          (SELECT count(*)::int FROM payment_attempts a WHERE a.order_id=o.id) attempts,
          (SELECT count(*)::int FROM payment_create_receipts r WHERE r.checkout_session_id=session.id) receipts,
          (SELECT count(*)::int FROM order_events e WHERE e.order_id=o.id) order_events,
          (SELECT count(*)::int FROM payment_attempt_events e JOIN payment_attempts a ON a.id=e.payment_attempt_id WHERE a.order_id=o.id) payment_events,
          (SELECT count(*)::int FROM outbox_events e JOIN payment_attempts a ON a.id=e.aggregate_id WHERE a.order_id=o.id) payment_outbox
         FROM checkout_sessions session JOIN orders o ON o.checkout_session_id=session.id WHERE session.id=$1::uuid`,
        [excluded.id],
      )
    ).rows[0];
  const trigger = (
    await context.client.query(
      "SELECT tgenabled,tgdeferrable,tginitdeferred FROM pg_trigger WHERE tgname='payment_runtime_receipt_validate'",
    )
  ).rows[0];
  check(
    trigger?.tgenabled === "O" &&
      trigger.tgdeferrable &&
      trigger.tginitdeferred,
    "Receipt admission proof retains the enabled, initially deferred production constraint",
  );

  for (const bypassAdmission of [false, true]) {
    const observed = {
      projectionChanges: 0,
      beginCalls: 0,
      beginCompleted: 0,
      rejectedAdmission: 0,
      bucketSelects: 0,
      excludedSqlResults: 0,
      admissionChanges: 0,
      deferredFailures: 0,
    };
    const before = await snapshot();
    const pspBefore = await context.psp.counts();
    check(
      before?.attempts === 0 && before.receipts === 0,
      "Independent guard proof starts from a genuine checkout with no attempt or receipt",
    );
    const api = await context.createPaymentApi({
      recovery: false,
      healthPolicies,
      createPersistence(database, options) {
        const actual = createPostgresPersistenceWithPoolFactory(
          database,
          options,
          (config) => {
            const pool = new Pool(config);
            return {
              end: () => pool.end(),
              on: (event, listener) => {
                pool.on(event, listener);
              },
              off: (event, listener) => {
                pool.off(event, listener);
              },
              async connect() {
                const client = await pool.connect();
                return {
                  release: (destroy) => client.release(destroy),
                  async query(text, values) {
                    try {
                      const result = await client.query(text, values);
                      if (
                        typeof text === "string" &&
                        text.startsWith(
                          "SELECT public.payment_rollout_bucket_v1('provider'",
                        ) &&
                        text.endsWith(" AS eligible") &&
                        values?.[0] === excluded.id
                      ) {
                        observed.bucketSelects++;
                        if (result.rows[0]?.eligible === false)
                          observed.excludedSqlResults++;
                        if (bypassAdmission) {
                          observed.admissionChanges++;
                          return { ...result, rows: [{ eligible: true }] };
                        }
                      }
                      return result;
                    } catch (error) {
                      if (
                        text === "COMMIT" &&
                        error?.code === "23514" &&
                        error?.where?.includes("assert_payment_runtime_receipt")
                      )
                        observed.deferredFailures++;
                      throw error;
                    }
                  },
                };
              },
            };
          },
        );
        return {
          ...actual,
          paymentRuntimeTransactionManager: {
            runInPaymentRuntimeTransaction(work) {
              return actual.paymentRuntimeTransactionManager.runInPaymentRuntimeTransaction(
                (repos) =>
                  work({
                    ...repos,
                    paymentRuntime: {
                      ...repos.paymentRuntime,
                      async loadContext(command) {
                        const current =
                          await repos.paymentRuntime.loadContext(command);
                        if (
                          command.checkoutSessionId !== excluded.id ||
                          current.routing === null
                        )
                          return current;
                        observed.projectionChanges++;
                        return {
                          ...current,
                          routing: {
                            ...current.routing,
                            routes: current.routing.routes.map((route) => ({
                              ...route,
                              providerRolloutBasisPoints: 10000,
                              rolloutBasisPoints: 10000,
                            })),
                          },
                        };
                      },
                      async beginCreate(command) {
                        observed.beginCalls++;
                        try {
                          const result =
                            await repos.paymentRuntime.beginCreate(command);
                          observed.beginCompleted++;
                          return result;
                        } catch (error) {
                          if (error?.code === "CAPABILITY_UNAVAILABLE")
                            observed.rejectedAdmission++;
                          throw error;
                        }
                      },
                    },
                  }),
              );
            },
          },
        };
      },
    });
    try {
      await paymentClient.create(excluded.session, excluded.id, capability, {
        target: api.base,
        key: randomUUID(),
        expected: bypassAdmission ? 503 : 409,
        code: bypassAdmission
          ? "TEMPORARY_UNAVAILABLE"
          : "CAPABILITY_UNAVAILABLE",
      });
      check(
        observed.projectionChanges > 0 && observed.beginCalls === 1,
        "Application consumes only the corrupted routing projection and reaches the real beginCreate with an ordinary authorized plan",
      );
      check(
        observed.bucketSelects === 1 && observed.excludedSqlResults === 1,
        "Actual PostgreSQL recomputes the excluded cohort from the original persisted identities and ratios",
      );
      if (bypassAdmission) {
        check(
          observed.admissionChanges === 1 &&
            observed.beginCompleted === 1 &&
            observed.deferredFailures === 1,
          "After one forged admission result, real writes finish and the unmodified receipt constraint rejects COMMIT with SQLSTATE 23514",
        );
      } else {
        check(
          observed.admissionChanges === 0 &&
            observed.beginCompleted === 0 &&
            observed.rejectedAdmission === 1 &&
            observed.deferredFailures === 0,
          "The real repository rejects the excluded checkout before inserting an attempt or receipt",
        );
      }
      check(
        JSON.stringify(await snapshot()) === JSON.stringify(before),
        "Rejected admission preserves exact order version, checkout status, attempts, receipts, history and outbox",
      );
      check(
        JSON.stringify(await context.psp.counts()) ===
          JSON.stringify(pspBefore),
        "Neither rejected guard proof dispatches PSP create, capture or reconcile",
      );
      results.push({
        boundary: bypassAdmission
          ? "DEFERRED_RECEIPT_GUARD"
          : "POSTGRES_BEGIN_CREATE",
        status: "PASS",
        ...observed,
      });
    } finally {
      await api.stop();
    }
  }
  return { schemaVersion: 1, status: "PASS", cases: results };
}
