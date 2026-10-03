import { useId } from "react";
import { Button } from "@fan-support/ui";
import type {
  AdminSessionPermission,
  SupportedLocale,
} from "@fan-support/contracts";
import type { PolicyWorkspaceData } from "./model";
import type { PoliciesCopy } from "./copy";
export function policyReviewAccess({
  workspace,
  actorId,
  permissions,
  localeScopes,
  dirty,
}: {
  workspace: PolicyWorkspaceData;
  actorId: string;
  permissions: readonly AdminSessionPermission[];
  localeScopes: readonly SupportedLocale[];
  dirty: boolean;
}) {
  const context = workspace.selected?.context;
  const current = Boolean(
    context &&
    !dirty &&
    !context.stale &&
    workspace.lifecycle.status === "DRAFT" &&
    localeScopes.includes(workspace.target.locale),
  );
  const actor = actorId.toLowerCase();
  const independent = Boolean(
    context &&
    actor !== context.audit.editorId.toLowerCase() &&
    actor !== context.structureEditorId.toLowerCase(),
  );
  return {
    submit: Boolean(
      current &&
      context?.audit.review.status === "DRAFT" &&
      actor === context.audit.editorId.toLowerCase() &&
      permissions.includes("content.edit"),
    ),
    approve: Boolean(
      current &&
      context?.audit.review.status === "IN_REVIEW" &&
      independent &&
      permissions.includes("content.translation.review"),
    ),
    independent,
  };
}
export function PolicyReview({
  copy,
  access,
  busy,
  checked,
  onCheck,
  onSubmit,
  onApprove,
}: {
  copy: PoliciesCopy;
  access: ReturnType<typeof policyReviewAccess>;
  busy: boolean;
  checked: boolean;
  onCheck: (value: boolean) => void;
  onSubmit: () => void;
  onApprove: () => void;
}) {
  const id = useId();
  return (
    <section className="policy-review" data-policy-review>
      <p className="mc-hint">{copy.reviewHint}</p>
      {!access.independent && <p className="mc-hint">{copy.independent}</p>}
      {access.approve && (
        <label className="policy-review-confirm" htmlFor={id}>
          <input
            id={id}
            type="checkbox"
            checked={checked}
            disabled={busy}
            onChange={(event) => onCheck(event.currentTarget.checked)}
          />
          {copy.reviewed}
        </label>
      )}
      <div className="admin-actions">
        <Button
          type="button"
          variant="secondary"
          disabled={busy || !access.submit}
          onClick={onSubmit}
          data-policy-submit
        >
          {copy.submit}
        </Button>
        <Button
          type="button"
          disabled={busy || !access.approve || !checked}
          onClick={onApprove}
          data-policy-approve
        >
          {copy.approve}
        </Button>
      </div>
    </section>
  );
}
