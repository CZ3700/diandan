import {
  publicErrorEnvelopeSchema,
  type PublicErrorEnvelope,
} from "@fan-support/contracts";

import { resolveRequestId } from "./request-id.js";

export const safeRuntimeErrorSchema = publicErrorEnvelopeSchema;

export type SafeRuntimeError = Readonly<PublicErrorEnvelope>;

function codeForStatus(
  statusCode: number,
): "NOT_FOUND" | "REQUEST_REJECTED" | "INTERNAL_ERROR" {
  if (statusCode === 404) {
    return "NOT_FOUND";
  }
  if (statusCode >= 400 && statusCode < 500) {
    return "REQUEST_REJECTED";
  }
  return "INTERNAL_ERROR";
}

export function createSafeRuntimeError(
  statusCode: number,
  requestId: unknown,
): SafeRuntimeError {
  return Object.freeze(
    publicErrorEnvelopeSchema.parse({
      schemaVersion: 1,
      code: codeForStatus(statusCode),
      requestId: resolveRequestId(requestId),
    }),
  );
}
