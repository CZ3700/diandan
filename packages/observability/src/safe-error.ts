import { z } from "zod";

import { isCanonicalRequestId, resolveRequestId } from "./request-id.js";

export const safeRuntimeErrorSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    code: z.enum(["NOT_FOUND", "REQUEST_REJECTED", "INTERNAL_ERROR"]),
    requestId: z.string().refine(isCanonicalRequestId),
  })
  .readonly();

export type SafeRuntimeError = Readonly<z.infer<typeof safeRuntimeErrorSchema>>;

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
  return Object.freeze({
    schemaVersion: 1,
    code: codeForStatus(statusCode),
    requestId: resolveRequestId(requestId),
  });
}
