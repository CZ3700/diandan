import type { PaymentWorkspace } from "./api";
/** UI mirrors the authorized command prerequisites; the server still checks each operation. */
export function availableValidationModes(
  workspace: PaymentWorkspace,
): ("PUBLISH" | "ROLLBACK")[] {
  if (!workspace.canEdit || !workspace.selected) return [];
  const selected = workspace.selected;
  if (selected.lifecycle === "DRAFT" || selected.lifecycle === "VALIDATED")
    return ["PUBLISH"];
  if (
    selected.lifecycle === "SUPERSEDED" &&
    selected.revisionId !== workspace.currentRevisionId &&
    workspace.history.some(
      (item) => item.revisionId === selected.revisionId && item.wasPublished,
    )
  )
    return ["ROLLBACK"];
  return [];
}
