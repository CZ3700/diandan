import { advancePaymentHealthWindow } from "@fan-support/domain";
import {
  paymentHealthPolicySchema,
  paymentHealthObservationSchema,
  paymentHealthRecordResultSchema,
  paymentHealthClaimProbeCommandSchema,
  paymentHealthCompleteProbeCommandSchema,
  type PaymentHealthObservation,
} from "@fan-support/contracts";
import {
  PaymentHealthRepositoryError,
  type PaymentHealthRepository,
} from "@fan-support/persistence-port";
import { draftRows } from "./content-draft-data.js";
import {
  canonicalHealthValue,
  healthSnapshot,
  loadLockedHealthState,
  lockHealthAccount,
  rejectHealth,
  transitionAccountHealth,
} from "./payment-health-data.js";
import { healthProbeContextAvailable } from "./payment-health-context.js";
import {
  claimHealthProbe,
  completeHealthProbe,
} from "./payment-health-probe.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";

function normalizedObservation(
  observation: PaymentHealthObservation,
): PaymentHealthObservation {
  return paymentHealthObservationSchema.parse({
    ...observation,
    observationId: observation.observationId.toLowerCase(),
    providerAccountId: observation.providerAccountId.toLowerCase(),
    probeContext:
      observation.probeContext === null
        ? null
        : {
            ...observation.probeContext,
            routeId: observation.probeContext.routeId.toLowerCase(),
            command: {
              ...observation.probeContext.command,
              providerAccountId:
                observation.probeContext.command.providerAccountId.toLowerCase(),
            },
          },
  });
}
/** Local health state is PostgreSQL-owned; all remote calls happen outside this repository. */
export function createPaymentHealthRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
): PaymentHealthRepository {
  // A PostgreSQL row lock serializes other transactions, not two overlapping
  // multi-statement methods on this same client. Queue both within the scope.
  let pending: Promise<void> = Promise.resolve();
  const tracked = <T>(work: () => Promise<T>) =>
    scope.trackOperation(() => {
      const result = pending.then(work).catch((error: unknown) => {
        if (error instanceof PaymentHealthRepositoryError) throw error;
        throw persistenceTransactionFailureFromPostgres(error);
      });
      pending = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    });
  return {
    initialize: (input) =>
      tracked(async () => {
        const parsed = paymentHealthPolicySchema.safeParse(input);
        if (!parsed.success) return rejectHealth("INVALID_INPUT");
        const policy = {
          ...parsed.data,
          providerAccountId: parsed.data.providerAccountId.toLowerCase(),
        };
        const account = await lockHealthAccount(
          client,
          policy.providerAccountId,
          policy.environment,
        );
        const canonical = canonicalHealthValue(policy);
        const [existing] = await draftRows(
          client,
          `SELECT policy.policy=$2::jsonb matches FROM public.payment_provider_health_state state JOIN public.payment_provider_health_policies policy ON policy.provider_account_id=state.provider_account_id AND policy.environment=state.environment AND policy.policy_version=state.policy_version WHERE state.provider_account_id=$1::uuid`,
          [policy.providerAccountId, canonical],
        );
        if (existing && existing["matches"] !== true)
          return rejectHealth("POLICY_CONFLICT");
        if (!existing) {
          await client.query(
            `INSERT INTO public.payment_provider_health_policies(provider_account_id,environment,policy_version,policy,policy_hash) VALUES($1::uuid,$2,$3,$4::jsonb,encode(sha256(convert_to(public.canonical_publication_json($4::jsonb),'UTF8')),'hex'))`,
            [
              policy.providerAccountId,
              policy.environment,
              policy.version,
              canonical,
            ],
          );
          await client.query(
            `INSERT INTO public.payment_provider_health_state(provider_account_id,environment,policy_version,probe_due_at) VALUES($1::uuid,$2,$5::integer,CASE WHEN $3::boolean THEN clock_timestamp()+$4::bigint*interval '1 millisecond' ELSE NULL END)`,
            [
              policy.providerAccountId,
              policy.environment,
              account["health_status"] === "UNAVAILABLE",
              policy.openDurationMs,
              policy.version,
            ],
          );
        }
        return healthSnapshot(await loadLockedHealthState(client, account));
      }),
    record: (input) =>
      tracked(async () => {
        const parsed = paymentHealthObservationSchema.safeParse(input);
        if (!parsed.success) return rejectHealth("INVALID_INPUT");
        const observation = normalizedObservation(parsed.data);
        const canonical = canonicalHealthValue(observation);
        const existingObservation = async () => {
          const [existing] = await draftRows(
            client,
            `SELECT observation=$2::jsonb matches FROM public.payment_provider_health_observations WHERE observation_id=$1::uuid`,
            [observation.observationId, canonical],
          );
          if (existing && existing["matches"] !== true)
            return rejectHealth("OBSERVATION_CONFLICT");
          return existing !== undefined;
        };
        // Append-only receipt lookup precedes fresh context validation; old receipts remain replayable.
        const existed = await existingObservation();
        const account = await lockHealthAccount(
          client,
          observation.providerAccountId,
          observation.environment,
        );
        const rows = await loadLockedHealthState(client, account);
        const result = (recorded: boolean) =>
          paymentHealthRecordResultSchema.parse({
            schemaVersion: 1,
            recorded,
            healthStatus: account["health_status"],
          });
        if (existed || (await existingObservation())) return result(false);
        if (
          observation.probeContext !== null &&
          !(await healthProbeContextAvailable(client, observation.probeContext))
        )
          return rejectHealth("CONTEXT_UNAVAILABLE");
        const inserted = await draftRows(
          client,
          `INSERT INTO public.payment_provider_health_observations(observation_id,provider_account_id,environment,policy_version,observation,observation_hash) VALUES($1::uuid,$2::uuid,$3,$5::integer,$4::jsonb,encode(sha256(convert_to(public.canonical_publication_json($4::jsonb),'UTF8')),'hex')) ON CONFLICT(observation_id) DO NOTHING RETURNING observation_id`,
          [
            observation.observationId,
            observation.providerAccountId,
            observation.environment,
            canonical,
            rows.policy.version,
          ],
        );
        if (inserted.length === 0) {
          await existingObservation();
          return result(false);
        }
        const window = advancePaymentHealthWindow({
          schemaVersion: 1,
          now: rows.now,
          windowStartedAt: rows.state["window_started_text"] as string | null,
          failureCount: Number(rows.state["failure_count"]),
          classification: observation.classification,
          policy: rows.policy,
        });
        const technical = observation.classification === "TECHNICAL_FAILURE";
        const opened =
          technical &&
          account["health_status"] === "HEALTHY" &&
          window.thresholdReached;
        if (opened)
          await transitionAccountHealth(
            client,
            rows,
            "UNAVAILABLE",
            "TECHNICAL_FAILURE_THRESHOLD",
            observation.observationId,
          );
        const invalidate =
          technical && account["health_status"] === "UNAVAILABLE";
        await client.query(
          `UPDATE public.payment_provider_health_state SET failure_count=$2,window_started_at=$3::timestamptz,probe_context=COALESCE($4::jsonb,probe_context),generation=generation+CASE WHEN $5::boolean THEN 1 ELSE 0 END,probe_id=CASE WHEN $5::boolean THEN NULL ELSE probe_id END,probe_expires_at=CASE WHEN $5::boolean THEN NULL ELSE probe_expires_at END,lease_account_version=CASE WHEN $5::boolean THEN NULL ELSE lease_account_version END,lease_policy_version=CASE WHEN $5::boolean THEN NULL ELSE lease_policy_version END,probe_due_at=CASE WHEN $5::boolean THEN GREATEST(probe_due_at,$6::timestamptz+$7::bigint*interval '1 millisecond') ELSE probe_due_at END,updated_at=GREATEST(updated_at,$6::timestamptz) WHERE provider_account_id=$1::uuid`,
          [
            observation.providerAccountId,
            window.failureCount,
            window.windowStartedAt,
            observation.probeContext === null
              ? null
              : canonicalHealthValue(observation.probeContext),
            invalidate,
            rows.now,
            rows.policy.openDurationMs,
          ],
        );
        return result(true);
      }),
    claimProbe: (input) =>
      tracked(async () => {
        const parsed = paymentHealthClaimProbeCommandSchema.safeParse(input);
        if (!parsed.success) return rejectHealth("INVALID_INPUT");
        return claimHealthProbe(client, parsed.data);
      }),
    completeProbe: (input) =>
      tracked(async () => {
        const parsed = paymentHealthCompleteProbeCommandSchema.safeParse(input);
        if (!parsed.success) return rejectHealth("INVALID_INPUT");
        return completeHealthProbe(client, parsed.data);
      }),
  };
}
