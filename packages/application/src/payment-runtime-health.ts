import { randomUUID } from "node:crypto";
import {
  paymentHealthClaimProbeCommandSchema,
  paymentHealthCompleteProbeCommandSchema,
  paymentHealthObservationSchema,
  paymentHealthProbeLeaseSchema,
  paymentHealthProbeResultSchema,
  paymentHealthRecordResultSchema,
  paymentHealthSnapshotSchema,
  type PaymentHealthOperation,
  type PaymentHealthPolicy,
  type PaymentHealthProbeContext,
  type PaymentPortCommand,
} from "@fan-support/contracts";
import type { PaymentHealthTransactionManager } from "@fan-support/persistence-port";
import type { PaymentRuntimeProviderRegistration } from "@fan-support/payment-port";
import {
  classifyPaymentHealthResponse,
  type PaymentHealthOutcome,
} from "./payment-runtime-health-classification.js";
import {
  createHealthPolicyReader,
  healthPolicyFingerprint,
  healthPolicyIdentity as key,
} from "./payment-runtime-health-policies.js";

export type PaymentRuntimeHealthOptions = Readonly<{
  transactions: PaymentHealthTransactionManager;
  policies: readonly PaymentHealthPolicy[];
  readPolicies?: () => readonly PaymentHealthPolicy[];
}>;
type Identity = Pick<PaymentHealthPolicy, "providerAccountId" | "environment">;
type ObservedCommand = Extract<
  PaymentPortCommand,
  { operation: PaymentHealthOperation }
>;
const thrownOutcome: PaymentHealthOutcome = {
  classification: "TECHNICAL_FAILURE",
  code: "UNEXPECTED_ADAPTER_FAILURE",
};
async function probeOutcome(
  command: ObservedCommand,
  invoke: () => Promise<unknown>,
  timeoutMs: number,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(invoke)
        .then(
          (response) => classifyPaymentHealthResponse(command, response),
          () => thrownOutcome,
        ),
      new Promise<PaymentHealthOutcome>((resolve) => {
        timer = setTimeout(
          () =>
            resolve({
              classification: "TECHNICAL_FAILURE",
              code: "TEMPORARY_UNAVAILABLE",
            }),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** PostgreSQL owns policy, counters and leases; process state only deduplicates successful bootstrap calls. */
export function createPaymentRuntimeHealth(
  options: PaymentRuntimeHealthOptions,
  providers: () => readonly PaymentRuntimeProviderRegistration[],
) {
  const readPolicies = createHealthPolicyReader(
    options.policies,
    options.readPolicies,
  );
  const initialized = new Map<string, Promise<boolean>>();
  const readyAccounts = new Map<string, string>();
  let bootstrapCursor = 0;
  async function initialize(identity: Identity) {
    const identityKey = key(identity);
    let policy: PaymentHealthPolicy | undefined;
    try {
      policy = readPolicies().get(identityKey);
    } catch {
      return false;
    }
    if (!policy) return false;
    const selected = policy;
    const fingerprint = healthPolicyFingerprint(selected);
    let pending = initialized.get(fingerprint);
    if (!pending) {
      pending = (async () => {
        try {
          const snapshot = paymentHealthSnapshotSchema.parse(
            await options.transactions.runInPaymentHealthTransaction(
              (repository) => repository.initialize(selected),
            ),
          );
          return (
            key(snapshot) === identityKey &&
            snapshot.policyVersion === selected.version
          );
        } catch {
          return false;
        }
      })();
      initialized.set(fingerprint, pending);
    }
    const ready = await pending;
    try {
      const latest = readPolicies().get(identityKey);
      if (!latest || healthPolicyFingerprint(latest) !== fingerprint) {
        initialized.delete(fingerprint);
        return false;
      }
    } catch {
      initialized.delete(fingerprint);
      return false;
    }
    if (ready) {
      const prior = readyAccounts.get(identityKey);
      if (prior && prior !== fingerprint) initialized.delete(prior);
      readyAccounts.set(identityKey, fingerprint);
    }
    if (!ready && initialized.get(fingerprint) === pending)
      initialized.delete(fingerprint);
    return ready;
  }
  async function record(
    command: ObservedCommand,
    outcome: PaymentHealthOutcome,
    probeContext: PaymentHealthProbeContext | null,
  ) {
    try {
      if (!(await initialize(command))) return false;
      const observation = paymentHealthObservationSchema.parse({
        schemaVersion: 1,
        observationId: randomUUID(),
        providerAccountId: command.providerAccountId,
        environment: command.environment,
        operation: command.operation,
        ...outcome,
        probeContext,
      });
      const result = paymentHealthRecordResultSchema.parse(
        await options.transactions.runInPaymentHealthTransaction((repository) =>
          repository.record(observation),
        ),
      );
      return result.healthStatus === "HEALTHY";
    } catch {
      // This bounded admission result must never overwrite an already-issued payment/reconcile result.
      return false;
    }
  }
  async function observe<Response>(
    command: ObservedCommand,
    invoke: () => Promise<Response>,
    probeContext: PaymentHealthProbeContext | null = null,
  ) {
    let response: Response;
    try {
      response = await invoke();
    } catch (error) {
      await record(command, thrownOutcome, probeContext);
      throw error;
    }
    const healthAvailable = await record(
      command,
      classifyPaymentHealthResponse(command, response),
      probeContext,
    );
    return { response, healthAvailable };
  }
  async function probeNext() {
    const byAccount = readPolicies();
    const registered = providers();
    const candidates = [...byAccount.values()].filter((policy) =>
      registered.some((entry) => key(entry.configuration) === key(policy)),
    );
    if (candidates.length > 0) {
      // A database outage must not multiply one sweep's wait by every configured account.
      await initialize(candidates[bootstrapCursor % candidates.length]!);
      bootstrapCursor = (bootstrapCursor + 1) % candidates.length;
    }
    const accounts: Identity[] = candidates
      .filter(
        (policy) =>
          readyAccounts.get(key(policy)) === healthPolicyFingerprint(policy),
      )
      .map(({ providerAccountId, environment }) => ({
        providerAccountId,
        environment,
      }));
    if (accounts.length === 0)
      return {
        schemaVersion: 1 as const,
        outcome: "SUCCESS" as const,
        processed: false,
      };
    const raw = await options.transactions.runInPaymentHealthTransaction(
      (repository) =>
        repository.claimProbe(
          paymentHealthClaimProbeCommandSchema.parse({
            schemaVersion: 1,
            accounts,
          }),
        ),
    );
    if (raw === null)
      return {
        schemaVersion: 1 as const,
        outcome: "SUCCESS" as const,
        processed: false,
      };
    const lease = paymentHealthProbeLeaseSchema.parse(raw);
    const provider = registered.find(
      (entry) => key(entry.configuration) === key(lease),
    );
    if (!provider || !accounts.some((account) => key(account) === key(lease)))
      throw new TypeError("Invalid payment health probe account");
    const captured = byAccount.get(key(lease))!;
    const current = readPolicies().get(key(lease));
    if (
      !current ||
      healthPolicyFingerprint(current) !== healthPolicyFingerprint(captured)
    )
      return {
        schemaVersion: 1 as const,
        outcome: "SUCCESS" as const,
        processed: false,
      };
    const outcome = await probeOutcome(
      lease.context.command,
      () => provider.provider.getCapabilities(lease.context.command),
      captured.probeLeaseMs,
    );
    paymentHealthProbeResultSchema.parse(
      await options.transactions.runInPaymentHealthTransaction((repository) =>
        repository.completeProbe(
          paymentHealthCompleteProbeCommandSchema.parse({
            schemaVersion: 1,
            lease,
            ...outcome,
          }),
        ),
      ),
    );
    return {
      schemaVersion: 1 as const,
      outcome: "SUCCESS" as const,
      processed: true,
    };
  }
  return Object.freeze({ initialize, observe, probeNext });
}
export type PaymentRuntimeHealth = ReturnType<
  typeof createPaymentRuntimeHealth
>;

export async function observePaymentProvider<Response>(
  health: PaymentRuntimeHealth | undefined,
  command: ObservedCommand,
  invoke: () => Promise<Response>,
  probeContext: PaymentHealthProbeContext | null = null,
) {
  return health
    ? health.observe(command, invoke, probeContext)
    : { response: await invoke(), healthAvailable: true };
}
