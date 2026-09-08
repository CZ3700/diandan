import type { ManagementCenterOperation } from "@fan-support/contracts";

export function canStartManagementWrite(
  busy: boolean,
  operations: readonly Pick<ManagementCenterOperation, "status">[],
): boolean {
  return (
    !busy && !operations.some((operation) => operation.status === "PROCESSING")
  );
}
