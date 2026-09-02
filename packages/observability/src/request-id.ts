import { randomUUID } from "node:crypto";

export const REQUEST_ID_HEADER = "x-request-id" as const;

const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function isCanonicalRequestId(value: unknown): value is string {
  return typeof value === "string" && CANONICAL_UUID_PATTERN.test(value);
}

export function resolveRequestId(
  candidate: unknown,
  generate: () => string = randomUUID,
): string {
  if (isCanonicalRequestId(candidate)) {
    return candidate;
  }

  const generated = generate();
  if (!isCanonicalRequestId(generated)) {
    throw new Error("Request ID generator returned an invalid value");
  }
  return generated;
}
