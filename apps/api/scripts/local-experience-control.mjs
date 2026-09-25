import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";

/** HTTP header strings may contain non-ASCII bytes; timingSafeEqual requires byte lengths. */
export function localControlAuthorized(request, token) {
  if (typeof request.headers.authorization !== "string") return false;
  const supplied = Buffer.from(request.headers.authorization);
  const expected = Buffer.from("Bearer " + token);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}
