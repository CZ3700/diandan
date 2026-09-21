import { randomUUID } from "node:crypto";
import {
  paymentHealthPolicySchema,
  paymentHealthSnapshotSchema,
  type PaymentHealthPolicy,
} from "@fan-support/contracts";
import { PaymentHealthRepositoryError } from "@fan-support/persistence-port";
import { canonicalPublicationValue } from "@fan-support/content";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import type { TransactionClient } from "./transaction-runner.js";

export const healthTimestamp = (expression: string) =>
  `to_char(${expression} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
export const canonicalHealthValue = canonicalPublicationValue;
export const rejectHealth = (
  code: ConstructorParameters<typeof PaymentHealthRepositoryError>[0],
): never => {
  throw new PaymentHealthRepositoryError(code);
};
export type HealthRows = {
  account: DraftRow;
  state: DraftRow;
  policy: PaymentHealthPolicy;
  now: string;
};

/** The account lock always precedes its state lock. No checkout/order locks belong here. */
export async function lockHealthAccount(
  client: TransactionClient,
  providerAccountId: string,
  environment: string,
) {
  const [account] = await draftRows(
    client,
    `SELECT * FROM public.payment_provider_accounts WHERE id=$1::uuid AND environment=$2 FOR UPDATE`,
    [providerAccountId, environment],
  );
  if (!account) return rejectHealth("NOT_CONFIGURED");
  return account;
}
export async function loadLockedHealthState(
  client: TransactionClient,
  account: DraftRow,
): Promise<HealthRows> {
  const [state] = await draftRows(
    client,
    `SELECT state.*,policy.policy,${healthTimestamp("state.window_started_at")} window_started_text,${healthTimestamp("state.probe_due_at")} probe_due_text,${healthTimestamp("state.probe_expires_at")} probe_expires_text FROM public.payment_provider_health_state state JOIN public.payment_provider_health_policies policy ON policy.provider_account_id=state.provider_account_id AND policy.environment=state.environment AND policy.policy_version=state.policy_version WHERE state.provider_account_id=$1::uuid AND state.environment=$2 FOR UPDATE OF state`,
    [account["id"], account["environment"]],
  );
  if (!state) return rejectHealth("NOT_CONFIGURED");
  const [time] = await draftRows(
    client,
    `SELECT ${healthTimestamp("clock_timestamp()")} now`,
  );
  return {
    account,
    state,
    policy: paymentHealthPolicySchema.parse(state["policy"]),
    now: String(time!["now"]),
  };
}
export function healthSnapshot(rows: HealthRows) {
  return paymentHealthSnapshotSchema.parse({
    schemaVersion: 1,
    providerAccountId: rows.account["id"],
    environment: rows.account["environment"],
    policyVersion: rows.policy.version,
    healthStatus: rows.account["health_status"],
    failureCount: Number(rows.state["failure_count"]),
    generation: Number(rows.state["generation"]),
    probeDueAt: rows.state["probe_due_text"],
  });
}
export async function transitionAccountHealth(
  client: TransactionClient,
  rows: HealthRows,
  target: "HEALTHY" | "UNAVAILABLE",
  reason: "TECHNICAL_FAILURE_THRESHOLD" | "RECOVERY_PROBE_SUCCEEDED",
  reference: string,
) {
  if (rows.account["health_status"] === target) return;
  const [time] = await draftRows(
    client,
    `SELECT ${healthTimestamp("GREATEST(clock_timestamp(),updated_at+interval '1 microsecond')")} changed_at FROM public.payment_provider_accounts WHERE id=$1::uuid`,
    [rows.account["id"]],
  );
  const changedAt = time!["changed_at"];
  const nextVersion = Number(rows.account["version"]) + 1;
  await client.query(
    `INSERT INTO public.payment_provider_health_events(id,provider_account_id,sequence,from_status,to_status,observer_kind,task_name,reason_code,request_id,correlation_id,occurred_at) VALUES($1::uuid,$2::uuid,$3::bigint,$4,$5,'SYSTEM','payment-health',$6,$7::uuid,$7::uuid,$8::timestamptz)`,
    [
      randomUUID(),
      rows.account["id"],
      nextVersion,
      rows.account["health_status"],
      target,
      reason,
      reference,
      changedAt,
    ],
  );
  await client.query(
    `UPDATE public.payment_provider_accounts SET health_status=$2,version=version+1,updated_at=$3::timestamptz WHERE id=$1::uuid AND version=$4::bigint`,
    [rows.account["id"], target, changedAt, rows.account["version"]],
  );
  rows.account["health_status"] = target;
  rows.account["version"] = nextVersion;
}
