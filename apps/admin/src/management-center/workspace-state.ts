import type { ManagementCenterOperation } from "@fan-support/contracts";

export function canStartManagementWrite(
  busy: boolean,
  operations: readonly Pick<ManagementCenterOperation, "status">[],
): boolean {
  return (
    !busy && !operations.some((operation) => operation.status === "PROCESSING")
  );
}

type ListedOperation = Pick<
  ManagementCenterOperation,
  "operationId" | "status" | "failure"
>;
type DismissalStorage = Pick<Storage, "getItem" | "setItem">;
const dismissedKey = "fan-admin:dismissed-operations";
const dismissedLimit = 50;

/** A failure nobody can retry only informs; once read, the operator may hide it. */
export function isDismissibleOperation(operation: ListedOperation): boolean {
  return operation.status === "FAILED" && operation.failure?.retryable !== true;
}

export function visibleManagementOperations<T extends ListedOperation>(
  operations: readonly T[],
  dismissed: ReadonlySet<string>,
): T[] {
  return operations.filter(
    (operation) =>
      operation.status !== "PUBLISHED" &&
      !(
        isDismissibleOperation(operation) &&
        dismissed.has(operation.operationId)
      ),
  );
}

/** Per-browser convenience only: unreadable storage shows every failure again. */
export function readDismissedOperations(
  storage: DismissalStorage | null,
): Set<string> {
  try {
    const value: unknown = JSON.parse(storage?.getItem(dismissedKey) ?? "[]");
    return new Set(
      Array.isArray(value)
        ? value.filter((id): id is string => typeof id === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

export function rememberDismissedOperation(
  storage: DismissalStorage | null,
  operationId: string,
): void {
  try {
    const ids = [...readDismissedOperations(storage)].filter(
      (id) => id !== operationId,
    );
    ids.push(operationId);
    storage?.setItem(dismissedKey, JSON.stringify(ids.slice(-dismissedLimit)));
  } catch {
    // Storage denied or full: the notice simply returns on the next load.
  }
}
