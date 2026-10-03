import type { ManagementBroker } from "./api";
import type { ManagementCopy } from "./copy";
import { ManagementSelect } from "./form-fields";

export type AssignmentState = "IDLE" | "SAVING" | "SAVED" | "FAILED" | "STALE";

/** A suspended or former broker keeps its artists until they are reassigned; say so by name. */
export function brokerName(
  broker: Pick<ManagementBroker, "displayName" | "active">,
  copy: ManagementCopy,
): string {
  return broker.active
    ? broker.displayName
    : copy.assignmentInactive.replace("{name}", broker.displayName);
}

/**
 * ADR-022: the broker an artist belongs to, for accounts that may assign. On an existing artist
 * a change is saved at once; on a new artist it is applied when the artist has been added.
 */
export function ArtistAssignment({
  copy,
  brokers,
  value,
  state,
  existing,
  onChange,
}: {
  copy: ManagementCopy;
  brokers: readonly ManagementBroker[];
  /** The broker's id, or null for unassigned. */
  value: string | null;
  state: AssignmentState;
  existing: boolean;
  onChange: (brokerId: string | null) => void;
}) {
  // Only active brokers can be chosen; the current one stays listed so the value is never lost.
  const choices = brokers.filter(
    (broker) => broker.active || broker.brokerId === value,
  );
  const failure =
    state === "FAILED"
      ? copy.assignmentFailed
      : state === "STALE"
        ? copy.assignmentStale
        : undefined;
  return (
    <div className="mc-assignment" data-management-assignment-state={state}>
      <ManagementSelect
        name="assignment"
        label={copy.assignment}
        value={value ?? ""}
        disabled={state === "SAVING"}
        description={
          existing ? copy.assignmentImmediate : copy.assignmentOnCreate
        }
        {...(failure ? { error: failure } : {})}
        onChange={(next) => onChange(next === "" ? null : next)}
      >
        <option value="">{copy.assignmentStudio}</option>
        {choices.map((broker) => (
          <option
            key={broker.brokerId}
            value={broker.brokerId}
            disabled={!broker.active}
          >
            {brokerName(broker, copy)}
          </option>
        ))}
      </ManagementSelect>
      <p className="mc-hint" role="status">
        {state === "SAVED" ? copy.assignmentSaved : ""}
      </p>
    </div>
  );
}
