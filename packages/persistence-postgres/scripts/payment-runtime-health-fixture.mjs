import { randomUUID } from "node:crypto";
import { Client } from "pg";

/** TEST-only health observation through the original event and account guards; published routing remains immutable. */
export async function changePaymentRuntimeTestHealth({
  clientConfig,
  providerAccountId,
  healthStatus,
}) {
  if (
    !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/iu.test(
      providerAccountId ?? "",
    ) ||
    !["HEALTHY", "UNAVAILABLE"].includes(healthStatus)
  )
    throw new TypeError("Invalid TEST payment health input");
  const client = new Client(clientConfig);
  let open = false;
  try {
    await client.connect();
    await client.query("BEGIN");
    open = true;
    const { rows } = await client.query(
      `SELECT environment,health_status,version,to_char(GREATEST(clock_timestamp(),updated_at+interval '1 microsecond') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') changed_at FROM public.payment_provider_accounts WHERE id=$1::uuid FOR UPDATE`,
      [providerAccountId],
    );
    const account = rows[0];
    if (rows.length !== 1 || account.environment !== "TEST")
      throw new TypeError(
        "Payment health fixture requires an existing TEST account",
      );
    const version = Number(account.version);
    if (
      !Number.isSafeInteger(version) ||
      version < 1 ||
      !["HEALTHY", "UNAVAILABLE"].includes(account.health_status)
    )
      throw new TypeError("Invalid TEST payment account health facts");
    const unchanged = account.health_status === healthStatus;
    if (!unchanged) {
      const event = await client.query(
        `INSERT INTO public.payment_provider_health_events(id,provider_account_id,sequence,from_status,to_status,observer_kind,task_name,reason_code,request_id,correlation_id,occurred_at) VALUES($1::uuid,$2::uuid,$3,$4,$5,'SYSTEM','payment-runtime-test-health','SYNTHETIC_TEST_HEALTH_CHANGE',$6::uuid,$7::uuid,$8::timestamptz)`,
        [
          randomUUID(),
          providerAccountId,
          version + 1,
          account.health_status,
          healthStatus,
          randomUUID(),
          randomUUID(),
          account.changed_at,
        ],
      );
      const updated = await client.query(
        `UPDATE public.payment_provider_accounts SET health_status=$2,version=version+1,updated_at=$3::timestamptz WHERE id=$1::uuid AND environment='TEST' AND version=$4`,
        [providerAccountId, healthStatus, account.changed_at, version],
      );
      if (event.rowCount !== 1 || updated.rowCount !== 1)
        throw new Error(
          "TEST payment health transition was not written exactly once",
        );
    }
    await client.query("COMMIT");
    open = false;
    return {
      schemaVersion: 1,
      outcome: "SUCCESS",
      action: unchanged ? "UNCHANGED" : "CHANGED",
      healthStatus,
      version: unchanged ? version : version + 1,
    };
  } catch (error) {
    if (open) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
