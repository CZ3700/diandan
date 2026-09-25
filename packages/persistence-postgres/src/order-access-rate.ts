import {
  orderAccessRateResultSchema,
  type OrderAccessRateCommand,
} from "@fan-support/contracts";
import { draftRows } from "./content-draft-data.js";
import { rejectOrderAccess } from "./order-access-data.js";
import type { TransactionClient } from "./transaction-runner.js";

/** One committed statement per request; failures do not erase already consumed limits. */
export async function consumeOrderAccessRate(
  client: TransactionClient,
  command: OrderAccessRateCommand,
) {
  const [row] = await draftRows(
    client,
    `WITH instant AS MATERIALIZED(SELECT clock_timestamp() now), consumed AS (
      INSERT INTO public.order_access_rate_limits(scope,bucket_digest,pepper_version,request_count,window_started_at,window_expires_at,updated_at)
      SELECT $1,decode($2,'hex'),$3,1,instant.now,instant.now+($4::integer*interval '1 second'),instant.now FROM instant
      ON CONFLICT(scope,bucket_digest,pepper_version) DO UPDATE SET
        request_count=CASE WHEN order_access_rate_limits.window_expires_at<=EXCLUDED.window_started_at THEN 1 ELSE LEAST(order_access_rate_limits.request_count+1,1000000) END,
        window_started_at=CASE WHEN order_access_rate_limits.window_expires_at<=EXCLUDED.window_started_at THEN EXCLUDED.window_started_at ELSE order_access_rate_limits.window_started_at END,
        window_expires_at=CASE WHEN order_access_rate_limits.window_expires_at<=EXCLUDED.window_started_at THEN EXCLUDED.window_expires_at ELSE order_access_rate_limits.window_expires_at END,
        updated_at=GREATEST(order_access_rate_limits.updated_at,EXCLUDED.updated_at)
      RETURNING request_count,window_expires_at
    ) SELECT consumed.request_count<=$5::integer allowed,CASE WHEN consumed.request_count<=$5::integer THEN 0 ELSE LEAST(3600,GREATEST(1,ceil(extract(epoch FROM consumed.window_expires_at-instant.now))::integer)) END retry_after_seconds FROM consumed CROSS JOIN instant`,
    [
      command.scope,
      command.bucket.tokenDigest,
      command.bucket.pepperVersion,
      command.windowSeconds,
      command.maxRequests,
    ],
  );
  if (!row) return rejectOrderAccess("TEMPORARY_UNAVAILABLE");
  return orderAccessRateResultSchema.parse({
    schemaVersion: 1,
    allowed: row["allowed"],
    retryAfterSeconds: row["retry_after_seconds"],
  });
}
