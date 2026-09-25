import type { ManagementCenterOperation } from "@fan-support/contracts";
import type { ManagementApi } from "./api";
import { AdminClientError } from "../workspace/client";
export function watchManagementOperation(
  api: Pick<ManagementApi, "read">,
  initial: ManagementCenterOperation,
  onChange: (operation: ManagementCenterOperation) => void,
  onError: (error: unknown) => void,
): () => void {
  let stopped = false;
  let current = initial;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function read() {
    try {
      const next = await api.read(current.operationId);
      if (stopped) return;
      if (
        next.version < current.version ||
        next.kind !== current.kind ||
        next.sourceLocale !== current.sourceLocale
      )
        throw new AdminClientError("INVALID_RESPONSE");
      current = next;
      onChange(next);
      if (next.status === "PROCESSING")
        timer = setTimeout(() => {
          void read();
        }, 2000);
    } catch (error) {
      if (!stopped) onError(error);
    }
  }
  onChange(initial);
  if (initial.status === "PROCESSING")
    timer = setTimeout(() => {
      void read();
    }, 2000);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
