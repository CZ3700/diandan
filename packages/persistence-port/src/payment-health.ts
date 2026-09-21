import type {
  PaymentHealthPolicy,
  PaymentHealthObservation,
  PaymentHealthSnapshot,
  PaymentHealthRecordResult,
  PaymentHealthClaimProbeCommand,
  PaymentHealthProbeLease,
  PaymentHealthCompleteProbeCommand,
  PaymentHealthProbeResult,
} from "@fan-support/contracts";
import type { JsonValue } from "./index.js";

export type PaymentHealthRepositoryErrorCode =
  | "INVALID_INPUT"
  | "NOT_CONFIGURED"
  | "POLICY_CONFLICT"
  | "OBSERVATION_CONFLICT"
  | "CONTEXT_UNAVAILABLE";
export class PaymentHealthRepositoryError extends Error {
  constructor(public readonly code: PaymentHealthRepositoryErrorCode) {
    super("payment health operation rejected");
    this.name = "PaymentHealthRepositoryError";
  }
}
export interface PaymentHealthRepository {
  initialize(policy: PaymentHealthPolicy): Promise<PaymentHealthSnapshot>;
  record(
    observation: PaymentHealthObservation,
  ): Promise<PaymentHealthRecordResult>;
  claimProbe(
    command: PaymentHealthClaimProbeCommand,
  ): Promise<PaymentHealthProbeLease | null>;
  completeProbe(
    command: PaymentHealthCompleteProbeCommand,
  ): Promise<PaymentHealthProbeResult>;
}
export interface PaymentHealthTransactionManager {
  /** No PSP calls inside a transaction; PostgreSQL decides time, policy and probe fences. */
  runInPaymentHealthTransaction<Result extends JsonValue>(
    work: (repository: PaymentHealthRepository) => Promise<Result>,
  ): Promise<Result>;
}
