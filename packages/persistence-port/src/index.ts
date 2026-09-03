import type {
  AppendOutboxEventCommand,
  AppendOutboxEventResponse,
  ApplyInventoryReservationCreationCommand,
  ApplyInventoryReservationCreationResponse,
  ApplyInventoryReservationTransitionCommand,
  ApplyInventoryReservationTransitionResponse,
  BeginIdempotencyCommand,
  BeginIdempotencyResponse,
  CompleteIdempotencyCommand,
  CompleteIdempotencyResponse,
  LoadInventoryForUpdateCommand,
  LoadInventoryForUpdateResponse,
  TransactionOptions,
  PersistenceTransactionFailure,
} from "@fan-support/contracts";

import { persistenceTransactionFailureSchema } from "@fan-support/contracts";

export {
  persistencePortCommandSchema,
  persistencePortErrorCodeSchema,
  persistencePortErrorSchema,
  persistencePortOperationSchema,
  persistencePortResponseSchema,
  persistenceTransactionFailureSchema,
  transactionOptionsSchema,
} from "@fan-support/contracts";
export type {
  AppendOutboxEventCommand,
  AppendOutboxEventResponse,
  ApplyInventoryReservationCreationCommand,
  ApplyInventoryReservationCreationResponse,
  ApplyInventoryReservationTransitionCommand,
  ApplyInventoryReservationTransitionResponse,
  BeginIdempotencyCommand,
  BeginIdempotencyResponse,
  CompleteIdempotencyCommand,
  CompleteIdempotencyResponse,
  LoadInventoryForUpdateCommand,
  LoadInventoryForUpdateResponse,
  PersistencePortCommand,
  PersistencePortError,
  PersistencePortFailure,
  PersistencePortResponse,
  PersistenceTransactionFailure,
  TransactionOptions,
} from "@fan-support/contracts";

function freezeTransactionFailure(
  failure: PersistenceTransactionFailure,
): PersistenceTransactionFailure {
  return Object.freeze({
    ...failure,
    error: Object.freeze({ ...failure.error }),
  });
}

export class PersistenceTransactionFailureError extends Error {
  public readonly failure: PersistenceTransactionFailure;
  declare public readonly retryAfterMs?: number;

  public constructor(failure: PersistenceTransactionFailure) {
    super("persistence transaction failed");
    this.name = "PersistenceTransactionFailureError";
    const parsed = persistenceTransactionFailureSchema.safeParse(failure);
    if (!parsed.success) {
      throw new Error("invalid persistence transaction failure");
    }
    this.failure = freezeTransactionFailure(parsed.data);
    if (parsed.data.error.retryAfterMs !== undefined) {
      Object.defineProperty(this, "retryAfterMs", {
        configurable: false,
        enumerable: true,
        value: parsed.data.error.retryAfterMs,
        writable: false,
      });
    }
  }

  public get code(): PersistenceTransactionFailure["error"]["code"] {
    return this.failure.error.code;
  }

  public get recovery(): PersistenceTransactionFailure["error"]["recovery"] {
    return this.failure.error.recovery;
  }

  public toJSON(): PersistenceTransactionFailure {
    return this.failure;
  }
}

export function parsePersistenceTransactionFailure(
  value: unknown,
): PersistenceTransactionFailure | undefined {
  const candidate =
    value instanceof PersistenceTransactionFailureError ? value.failure : value;
  const parsed = persistenceTransactionFailureSchema.safeParse(candidate);
  return parsed.success ? freezeTransactionFailure(parsed.data) : undefined;
}

export interface IdempotencyRepository {
  begin(command: BeginIdempotencyCommand): Promise<BeginIdempotencyResponse>;
  complete(
    command: CompleteIdempotencyCommand,
  ): Promise<CompleteIdempotencyResponse>;
}

export interface OutboxRepository {
  append(command: AppendOutboxEventCommand): Promise<AppendOutboxEventResponse>;
}

export interface InventoryRepository {
  loadManyForUpdate(
    command: LoadInventoryForUpdateCommand,
  ): Promise<LoadInventoryForUpdateResponse>;
  applyReservationCreation(
    command: ApplyInventoryReservationCreationCommand,
  ): Promise<ApplyInventoryReservationCreationResponse>;
  applyReservationTransition(
    command: ApplyInventoryReservationTransitionCommand,
  ): Promise<ApplyInventoryReservationTransitionResponse>;
}

export type TransactionRepositories = Readonly<{
  idempotency: IdempotencyRepository;
  outbox: OutboxRepository;
  inventory: InventoryRepository;
}>;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | Readonly<{ [key: string]: JsonValue }>;

export interface TransactionManager {
  /**
   * Infrastructure failures reject with PersistenceTransactionFailureError;
   * callback failures are propagated unchanged. Successful values are returned
   * as deeply frozen canonical JSON snapshots, never as the callback's mutable
   * object reference.
   */
  runInTransaction<Result extends JsonValue>(
    options: TransactionOptions,
    work: (repositories: TransactionRepositories) => Promise<Result>,
  ): Promise<Result>;
}

export const workspacePackageName = "@fan-support/persistence-port" as const;
