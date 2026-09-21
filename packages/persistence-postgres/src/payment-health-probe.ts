import { randomUUID } from "node:crypto";
import {
  paymentHealthObservationSchema,
  paymentHealthProbeContextSchema,
  paymentHealthProbeLeaseSchema,
  paymentHealthProbeResultSchema,
  type PaymentHealthClaimProbeCommand,
  type PaymentHealthCompleteProbeCommand,
} from "@fan-support/contracts";
import { draftRows } from "./content-draft-data.js";
import {
  canonicalHealthValue,
  healthTimestamp,
  loadLockedHealthState,
  lockHealthAccount,
  rejectHealth,
  transitionAccountHealth,
  type HealthRows,
} from "./payment-health-data.js";
import { healthProbeContextAvailable } from "./payment-health-context.js";
import type { TransactionClient } from "./transaction-runner.js";

async function deferProbe(client: TransactionClient, rows: HealthRows) {
  await client.query(
    `UPDATE public.payment_provider_health_state SET probe_id=NULL,probe_expires_at=NULL,lease_account_version=NULL,lease_policy_version=NULL,probe_due_at=$2::timestamptz+$3::bigint*interval '1 millisecond',updated_at=GREATEST(updated_at,$2::timestamptz) WHERE provider_account_id=$1::uuid`,
    [rows.account["id"], rows.now, rows.policy.probeRetryMs],
  );
}
/** Lock at most one account; independent callers never lock the due state first. */
export async function claimHealthProbe(
  client: TransactionClient,
  command: PaymentHealthClaimProbeCommand,
) {
  const [account] = await draftRows(
    client,
    `SELECT account.* FROM public.payment_provider_accounts account JOIN public.payment_provider_health_state state ON state.provider_account_id=account.id AND state.environment=account.environment
    WHERE account.health_status='UNAVAILABLE' AND state.probe_due_at<=clock_timestamp()
      AND (state.probe_expires_at IS NULL OR state.probe_expires_at<=clock_timestamp())
      AND EXISTS(SELECT 1 FROM jsonb_to_recordset($1::jsonb) AS allowed("providerAccountId" uuid,environment text) WHERE allowed."providerAccountId"=account.id AND allowed.environment=account.environment)
    ORDER BY state.probe_due_at,account.id LIMIT 1 FOR UPDATE OF account SKIP LOCKED`,
    [JSON.stringify(command.accounts)],
  );
  if (!account) return null;
  const rows = await loadLockedHealthState(client, account);
  const [eligibility] = await draftRows(
    client,
    `SELECT probe_due_at<=clock_timestamp() AND (probe_expires_at IS NULL OR probe_expires_at<=clock_timestamp()) eligible FROM public.payment_provider_health_state WHERE provider_account_id=$1::uuid`,
    [account["id"]],
  );
  if (eligibility?.["eligible"] !== true) return null;
  const parsedContext = paymentHealthProbeContextSchema.safeParse(
    rows.state["probe_context"],
  );
  if (
    !parsedContext.success ||
    !(await healthProbeContextAvailable(client, parsedContext.data))
  ) {
    await deferProbe(client, rows);
    return null;
  }
  const probeId = randomUUID();
  const [leased] = await draftRows(
    client,
    `UPDATE public.payment_provider_health_state SET generation=generation+1,probe_id=$2::uuid,lease_account_version=$4::bigint,lease_policy_version=policy_version,probe_expires_at=clock_timestamp()+$3::bigint*interval '1 millisecond',updated_at=GREATEST(updated_at,clock_timestamp()) WHERE provider_account_id=$1::uuid RETURNING generation,${healthTimestamp("probe_expires_at")} expires_at`,
    [account["id"], probeId, rows.policy.probeLeaseMs, account["version"]],
  );
  return paymentHealthProbeLeaseSchema.parse({
    schemaVersion: 1,
    probeId,
    providerAccountId: account["id"],
    environment: account["environment"],
    generation: Number(leased!["generation"]),
    expiresAt: leased!["expires_at"],
    context: parsedContext.data,
  });
}

export async function completeHealthProbe(
  client: TransactionClient,
  command: PaymentHealthCompleteProbeCommand,
) {
  const lease = command.lease;
  const account = await lockHealthAccount(
    client,
    lease.providerAccountId,
    lease.environment,
  );
  const rows = await loadLockedHealthState(client, account);
  const result = (applied: boolean) =>
    paymentHealthProbeResultSchema.parse({
      schemaVersion: 1,
      applied,
      healthStatus: account["health_status"],
    });
  const [fence] = await draftRows(
    client,
    `SELECT health.probe_id=$2::uuid AND health.generation=$3::bigint AND health.probe_expires_at=$4::timestamptz AND health.probe_expires_at>clock_timestamp() AND health.probe_context=$5::jsonb AND health.lease_account_version=$6::bigint AND health.lease_policy_version=health.policy_version valid FROM public.payment_provider_health_state health WHERE provider_account_id=$1::uuid`,
    [
      lease.providerAccountId,
      lease.probeId,
      lease.generation,
      lease.expiresAt,
      canonicalHealthValue(lease.context),
      account["version"],
    ],
  );
  if (account["health_status"] !== "UNAVAILABLE" || fence?.["valid"] !== true)
    return result(false);
  const observation = paymentHealthObservationSchema.parse({
    schemaVersion: 1,
    observationId: lease.probeId,
    providerAccountId: account["id"],
    environment: account["environment"],
    operation: "GET_CAPABILITIES",
    classification: command.classification,
    code: command.code,
    probeContext: lease.context,
  });
  const saved = await draftRows(
    client,
    `INSERT INTO public.payment_provider_health_observations(observation_id,provider_account_id,environment,policy_version,observation,observation_hash,source,probe_generation,lease_account_version) VALUES($1::uuid,$2::uuid,$3,$4::integer,$5::jsonb,encode(sha256(convert_to(public.canonical_publication_json($5::jsonb),'UTF8')),'hex'),'PROBE',$6::bigint,$7::bigint) ON CONFLICT(observation_id) DO NOTHING RETURNING observation_id`,
    [
      lease.probeId,
      account["id"],
      account["environment"],
      rows.policy.version,
      canonicalHealthValue(observation),
      lease.generation,
      account["version"],
    ],
  );
  if (saved.length !== 1) return rejectHealth("OBSERVATION_CONFLICT");
  if (
    command.classification !== "SUCCESS" ||
    !(await healthProbeContextAvailable(client, lease.context))
  ) {
    await deferProbe(client, rows);
    return result(true);
  }
  await transitionAccountHealth(
    client,
    rows,
    "HEALTHY",
    "RECOVERY_PROBE_SUCCEEDED",
    lease.probeId,
  );
  await client.query(
    `UPDATE public.payment_provider_health_state SET failure_count=0,window_started_at=NULL,probe_id=NULL,probe_expires_at=NULL,lease_account_version=NULL,lease_policy_version=NULL,probe_due_at=NULL,updated_at=GREATEST(updated_at,clock_timestamp()) WHERE provider_account_id=$1::uuid`,
    [lease.providerAccountId],
  );
  return result(true);
}
