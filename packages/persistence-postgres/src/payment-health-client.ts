import { performance } from "node:perf_hooks";
import type { TransactionClient } from "./transaction-runner.js";

function deadlineFailure() {
  return Object.assign(
    new Error("Payment health persistence deadline exceeded"),
    { code: "08006" },
  );
}
function isServerDeadline(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const descriptor = Object.getOwnPropertyDescriptor(error, "code");
  return (
    descriptor &&
    "value" in descriptor &&
    ["57014", "55P03", "25P03", "25P04"].includes(String(descriptor.value))
  );
}

/** One acquisition-to-release budget. Expiry destroys this checked-out connection,
 * so neither a late pool delivery nor a late query can continue a health write. */
export async function acquirePaymentHealthClient(
  acquire: () => Promise<TransactionClient>,
  timeoutMs: number,
): Promise<TransactionClient> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000)
    throw new TypeError("Invalid payment health persistence timeout");
  const end = performance.now() + timeoutMs;
  let client: TransactionClient | undefined;
  let released = false;
  let expired = false;
  let rejectDeadline!: (error: Error) => void;
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });
  const release = (destroy?: boolean) => {
    if (released) return;
    released = true;
    clearTimeout(timer);
    try {
      client?.release(destroy);
    } catch {
      /* Connection disposal cannot change an uncertain commit outcome. */
    }
  };
  const expire = () => {
    if (expired) return;
    expired = true;
    release(true);
    rejectDeadline(deadlineFailure());
  };
  const timer = setTimeout(expire, timeoutMs);
  const acquisition = Promise.resolve()
    .then(acquire)
    .then((acquired) => {
      if (expired || released) {
        try {
          acquired.release(true);
        } catch {
          /* Late resources still must never run SQL. */
        }
        throw deadlineFailure();
      }
      client = acquired;
      return acquired;
    });
  try {
    await Promise.race([acquisition, deadline]);
  } catch (error) {
    release(true);
    throw error;
  }

  async function query(text: string, values?: unknown[]): Promise<unknown> {
    if (expired || released || !client) throw deadlineFailure();
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => client!.query(text, values)),
        deadline,
      ]);
      if (/^BEGIN\b/u.test(text)) {
        // PostgreSQL also bounds backend lock/statement/transaction lifetime if
        // a client disconnect is not observed immediately by a blocked backend.
        const remaining = Math.max(1, Math.ceil(end - performance.now()));
        await query(
          "SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$1,true),set_config('transaction_timeout',$1,true)",
          [`${remaining}ms`],
        );
      }
      return result;
    } catch (error) {
      if (isServerDeadline(error)) {
        expire();
        throw deadlineFailure();
      }
      throw error;
    }
  }
  return { query, release };
}
