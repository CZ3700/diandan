import {
  orderAccessIssueCommandSchema,
  orderAccessExchangeCommandSchema,
  orderAccessBootstrapCommandSchema,
  orderAccessReadCommandSchema,
  orderAccessRevokeCommandSchema,
  orderAccessLocateCommandSchema,
  orderAccessLocatedSchema,
  orderAccessGrantSchema,
  orderAccessRevokedSchema,
  orderAccessDetailSchema,
  orderAccessFailureCodeSchema,
  orderAccessRateCommandSchema,
  orderAccessRateResultSchema,
  type OrderAccessFailureCode,
  type OrderAccessResponse,
  type OrderAccessRateResult,
} from "@fan-support/contracts";
import {
  OrderAccessRepositoryError,
  type JsonValue,
  type OrderAccessRepository,
  type OrderAccessTransactionManager,
} from "@fan-support/persistence-port";

export class OrderAccessApplicationError extends Error {
  constructor() {
    super("Order access unavailable");
    this.name = "OrderAccessApplicationError";
  }
}

type CommandSchema<Command> = {
  safeParse(
    input: unknown,
  ): { success: true; data: Command } | { success: false };
};
const fail = (code: OrderAccessFailureCode): OrderAccessResponse => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code,
});

/** Raw credentials never cross this boundary. Validate every result before COMMIT. */
export function createOrderAccessUseCases({
  transactions,
}: {
  transactions: OrderAccessTransactionManager;
}) {
  async function execute<Command, Result extends JsonValue>(
    schema: CommandSchema<Command>,
    input: unknown,
    work: (
      repository: OrderAccessRepository,
      command: Command,
    ) => Promise<Result>,
    response: (value: Result) => OrderAccessResponse,
  ): Promise<OrderAccessResponse> {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return fail("INVALID_REQUEST");
    try {
      return response(
        await transactions.runInOrderAccessTransaction((repository) =>
          work(repository, parsed.data),
        ),
      );
    } catch (error) {
      const known =
        error instanceof OrderAccessRepositoryError
          ? orderAccessFailureCodeSchema.safeParse(error.code)
          : undefined;
      return fail(known?.success ? known.data : "TEMPORARY_UNAVAILABLE");
    }
  }
  const granted = (
    grant: ReturnType<typeof orderAccessGrantSchema.parse>,
  ): OrderAccessResponse => ({
    schemaVersion: 1,
    outcome: "SUCCESS",
    action: "GRANTED",
    grant,
  });
  const issue = (input: unknown) =>
    execute(
      orderAccessIssueCommandSchema,
      input,
      async (repository, command) =>
        orderAccessGrantSchema.parse(await repository.issue(command)),
      granted,
    );
  const exchange = (input: unknown) =>
    execute(
      orderAccessExchangeCommandSchema,
      input,
      async (repository, command) =>
        orderAccessGrantSchema.parse(await repository.exchange(command)),
      granted,
    );
  const bootstrap = (input: unknown) =>
    execute(
      orderAccessBootstrapCommandSchema,
      input,
      async (repository, command) =>
        orderAccessGrantSchema.parse(await repository.bootstrap(command)),
      granted,
    );
  const read = (input: unknown) =>
    execute(
      orderAccessReadCommandSchema,
      input,
      async (repository, command) => {
        const order = orderAccessDetailSchema.parse(
          await repository.read(command),
        );
        if (
          order.publicOrderId.toLowerCase() !==
          command.publicOrderId.toLowerCase()
        )
          throw new OrderAccessApplicationError();
        return order;
      },
      (order) => ({
        schemaVersion: 1,
        outcome: "SUCCESS",
        action: "READ",
        order,
      }),
    );
  const revoke = (input: unknown) =>
    execute(
      orderAccessRevokeCommandSchema,
      input,
      async (repository, command) => {
        const result = orderAccessRevokedSchema.parse(
          await repository.revoke(command),
        );
        if (
          result.publicOrderId.toLowerCase() !==
          command.publicOrderId.toLowerCase()
        )
          throw new OrderAccessApplicationError();
        return result;
      },
      ({ publicOrderId }) => ({
        schemaVersion: 1,
        outcome: "SUCCESS",
        action: "REVOKED",
        publicOrderId,
      }),
    );
  const locate = (input: unknown) =>
    execute(
      orderAccessLocateCommandSchema,
      input,
      async (repository, command) =>
        orderAccessLocatedSchema.parse(await repository.locate(command)),
      ({ publicOrderId }) => ({
        schemaVersion: 1,
        outcome: "SUCCESS",
        action: "LOCATED",
        publicOrderId,
      }),
    );
  // Always a separate committed call, including rejected guesses. Never roll the
  // limiter back with the following authorization transaction.
  const consumeRateLimit = async (
    input: unknown,
  ): Promise<OrderAccessRateResult> => {
    const parsed = orderAccessRateCommandSchema.safeParse(input);
    if (!parsed.success) throw new OrderAccessApplicationError();
    try {
      return await transactions.runInOrderAccessTransaction(
        async (repository) =>
          orderAccessRateResultSchema.parse(
            await repository.consumeRateLimit(parsed.data),
          ),
      );
    } catch {
      throw new OrderAccessApplicationError();
    }
  };
  return Object.freeze({
    issue,
    exchange,
    bootstrap,
    read,
    revoke,
    locate,
    consumeRateLimit,
  });
}

export type OrderAccessUseCases = ReturnType<typeof createOrderAccessUseCases>;
