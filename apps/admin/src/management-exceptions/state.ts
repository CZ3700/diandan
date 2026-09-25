import { AdminClientError } from "../workspace/client";
export function uncertainExceptionResult(error: unknown): boolean {
  return (
    !(error instanceof AdminClientError) ||
    [
      "NETWORK_ERROR",
      "INVALID_RESPONSE",
      "TEMPORARY_UNAVAILABLE",
      "CONTENT_UNAVAILABLE",
    ].includes(error.code)
  );
}
export function exceptionAccessLost(error: unknown): boolean {
  return (
    error instanceof AdminClientError &&
    ["FORBIDDEN", "UNAUTHENTICATED", "CSRF_INVALID"].includes(error.code)
  );
}
