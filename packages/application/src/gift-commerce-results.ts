import type {
  AdminPrincipal,
  GiftCommerceFailure,
} from "@fan-support/contracts";
import { compareBaseContentTime } from "./base-content-time.js";

export const commerceFailure = (
  code: GiftCommerceFailure["code"],
): GiftCommerceFailure => ({ schemaVersion: 1, outcome: "FAILURE", code });
export class CommerceRejected extends Error {
  constructor(readonly failure: GiftCommerceFailure) {
    super("gift commerce command rejected");
  }
}
export function rejectCommerce(code: GiftCommerceFailure["code"]): never {
  throw new CommerceRejected(commerceFailure(code));
}
export function requireCommerceSuccess<
  T extends { outcome: "SUCCESS" } | GiftCommerceFailure,
>(value: T): Extract<T, { outcome: "SUCCESS" }> {
  if (value.outcome === "FAILURE") throw new CommerceRejected(value);
  return value as Extract<T, { outcome: "SUCCESS" }>;
}
export const sameCommerceId = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();
export function requireSameCommercePrincipal(
  current: AdminPrincipal,
  prior?: AdminPrincipal,
): AdminPrincipal {
  if (
    prior &&
    (!sameCommerceId(current.actorId, prior.actorId) ||
      !sameCommerceId(current.sessionId, prior.sessionId) ||
      compareBaseContentTime(current.expiresAt, prior.expiresAt) !== 0)
  )
    rejectCommerce("COMMERCE_UNAVAILABLE");
  if (compareBaseContentTime(current.expiresAt, current.authorizedAt) <= 0)
    rejectCommerce("UNAUTHENTICATED");
  return current;
}
export function rejectCommercePersistence(code: string): never {
  if (code === "TRANSACTION_ABORTED" || code === "VERSION_CONFLICT")
    rejectCommerce("CONFLICT");
  if (code === "IDEMPOTENCY_CONFLICT") rejectCommerce("IDEMPOTENCY_CONFLICT");
  if (code === "ALREADY_EXISTS") rejectCommerce("ALREADY_EXISTS");
  rejectCommerce("COMMERCE_UNAVAILABLE");
}
