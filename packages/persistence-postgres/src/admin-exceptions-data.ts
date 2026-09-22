import type {
  AdminExceptionsFailure,
  AdminExceptionTarget,
} from "@fan-support/contracts";
export { draftRows, type DraftRow } from "./content-draft-data.js";
export { adminOrdersTimestamp } from "./admin-orders-data.js";
export type { TransactionClient } from "./transaction-runner.js";
export const exceptionFailure = (
  code: AdminExceptionsFailure["code"],
): AdminExceptionsFailure => ({ schemaVersion: 1, outcome: "FAILURE", code });
export const exceptionTargetKey = (target: AdminExceptionTarget) =>
  `admin-exception:${target.kind}:${target.id}:${target.consumerKey ?? ""}`;
