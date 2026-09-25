import { PersistenceTransactionFailureError } from "@fan-support/persistence-port";

/** Only replay complete management transactions whose rollback is confirmed. */
export async function retryManagementTransaction<Result>(
  work: () => Promise<Result>,
): Promise<Result> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (
        !(error instanceof PersistenceTransactionFailureError) ||
        error.code !== "TRANSACTION_ABORTED" ||
        error.recovery !== "RETRY_SAME_COMMAND" ||
        attempt >= 2
      )
        throw error;
      // The rejected transaction has released its locks. Its next callback
      // must reload the live fence; external media I/O stays outside this loop.
      await new Promise<void>((resolve) =>
        setTimeout(resolve, error.retryAfterMs),
      );
    }
  }
}
