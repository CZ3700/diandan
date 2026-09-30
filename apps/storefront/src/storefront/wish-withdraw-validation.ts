import {
  wishGalleryWithdrawResponseSchema,
  type WishGalleryWithdrawResponse,
} from "@fan-support/contracts";
export type WishWithdrawReply =
  | (WishGalleryWithdrawResponse & { retryAfterSeconds?: number })
  | { schemaVersion: 1; outcome: "UNKNOWN" };
const statuses = {
  INVALID_REQUEST: [400, 413],
  ACCESS_DENIED: [401, 403],
  RATE_LIMITED: [429],
  TEMPORARY_UNAVAILABLE: [503],
};
/** A withdrawal grants no new authority and must name the requested gallery record. */
export function validateWishWithdrawResponse(
  value: unknown,
  status: number,
  headers: Headers,
  entryId: string,
): WishGalleryWithdrawResponse & { retryAfterSeconds?: number } {
  const result = wishGalleryWithdrawResponseSchema.parse(value);
  if (headers.has("x-csrf-token") || headers.has("set-cookie"))
    throw new Error("Unexpected wish credential");
  const retry = headers.get("retry-after");
  if (result.outcome === "FAILURE") {
    if (!statuses[result.code].includes(status))
      throw new Error("Invalid wish failure status");
    if (result.code === "RATE_LIMITED") {
      if (!/^[1-9]\d{0,3}$/u.test(retry ?? "") || Number(retry) > 3600)
        throw new Error("Invalid wish retry delay");
      return { ...result, retryAfterSeconds: Number(retry) };
    }
    if (retry !== null) throw new Error("Unexpected wish retry delay");
  } else if (
    status !== 200 ||
    retry !== null ||
    result.withdrawn.entryId.toLowerCase() !== entryId.toLowerCase()
  )
    throw new Error("Invalid wish withdrawal scope");
  return result;
}
