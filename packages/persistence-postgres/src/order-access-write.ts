import { randomUUID } from "node:crypto";
import {
  orderAccessGrantSchema,
  type OrderAccessCredential,
  type OrderAccessIssueCommand,
} from "@fan-support/contracts";
import { cartTimestamp } from "./cart-runtime-data.js";
import { draftRows, type DraftRow } from "./content-draft-data.js";
import { oneAccessRow, rejectOrderAccess } from "./order-access-data.js";
import type { TransactionClient } from "./transaction-runner.js";

export async function retireAccessTokens(
  client: TransactionClient,
  orderId: unknown,
) {
  await client.query(
    `WITH instant AS MATERIALIZED(SELECT clock_timestamp() now) UPDATE public.order_access_tokens token SET status=CASE WHEN token.expires_at<=instant.now THEN 'EXPIRED' ELSE 'REVOKED' END,version=token.version+1,expired_at=CASE WHEN token.expires_at<=instant.now THEN instant.now ELSE NULL END,revoked_at=CASE WHEN token.expires_at>instant.now THEN instant.now ELSE NULL END FROM instant WHERE token.order_id=$1::uuid AND token.status='ACTIVE'`,
    [orderId],
  );
}
export async function retireAccessSessions(
  client: TransactionClient,
  orderId: unknown,
) {
  await client.query(
    `WITH instant AS MATERIALIZED(SELECT clock_timestamp() now) UPDATE public.order_access_sessions session SET status=CASE WHEN session.expires_at<=instant.now THEN 'EXPIRED' ELSE 'REVOKED' END,version=session.version+1,expired_at=CASE WHEN session.expires_at<=instant.now THEN instant.now ELSE NULL END,revoked_at=CASE WHEN session.expires_at>instant.now THEN instant.now ELSE NULL END FROM instant WHERE session.order_id=$1::uuid AND session.status='ACTIVE'`,
    [orderId],
  );
}
export async function insertAccessToken(
  client: TransactionClient,
  orderId: unknown,
  credential: OrderAccessCredential,
  ttlSeconds: number,
  purpose: "LINK" | "CHECKOUT_BOOTSTRAP" = "LINK",
) {
  return oneAccessRow(
    await draftRows(
      client,
      `WITH instant AS MATERIALIZED(SELECT clock_timestamp() now) INSERT INTO public.order_access_tokens(id,order_id,token_digest,token_pepper_version,status,expires_at,created_at,purpose) SELECT $1::uuid,$2::uuid,decode($3,'hex'),$4,'ACTIVE',instant.now+($5::integer*interval '1 second'),instant.now,$6 FROM instant RETURNING id,${cartTimestamp("expires_at")} expires_at`,
      [
        randomUUID(),
        orderId,
        credential.tokenDigest,
        credential.pepperVersion,
        ttlSeconds,
        purpose,
      ],
    ),
  );
}
export async function consumeAccessToken(
  client: TransactionClient,
  order: DraftRow,
  tokenId: unknown,
  credential: OrderAccessCredential,
  ttlSeconds: number,
) {
  const rows = await draftRows(
    client,
    `WITH instant AS MATERIALIZED(SELECT clock_timestamp() now) UPDATE public.order_access_tokens token SET status='EXCHANGED',version=token.version+1,exchanged_at=instant.now FROM instant WHERE token.id=$1::uuid AND token.order_id=$2::uuid AND token.status='ACTIVE' AND token.created_at<=instant.now AND token.expires_at>instant.now RETURNING token.id,${cartTimestamp("token.exchanged_at")} exchanged_at`,
    [tokenId, order["id"]],
  );
  if (rows.length !== 1) return rejectOrderAccess("ACCESS_DENIED");
  const session = oneAccessRow(
    await draftRows(
      client,
      `INSERT INTO public.order_access_sessions(id,order_id,public_order_id,exchanged_token_id,session_token_digest,token_pepper_version,status,expires_at,created_at,last_seen_at) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,decode($5,'hex'),$6,'ACTIVE',$7::timestamptz+($8::integer*interval '1 second'),$7::timestamptz,$7::timestamptz) RETURNING id,${cartTimestamp("expires_at")} expires_at`,
      [
        randomUUID(),
        order["id"],
        order["public_order_id"],
        tokenId,
        credential.tokenDigest,
        credential.pepperVersion,
        rows[0]!["exchanged_at"],
        ttlSeconds,
      ],
    ),
  );
  return {
    sessionId: session["id"],
    grant: orderAccessGrantSchema.parse({
      schemaVersion: 1,
      publicOrderId: order["public_order_id"],
      expiresAt: session["expires_at"],
    }),
  };
}
type Trace = Pick<
  OrderAccessIssueCommand,
  "requestId" | "correlationId" | "taskName"
>;
export async function auditOrderAccess(
  client: TransactionClient,
  trace: Trace,
  action: "ISSUE" | "EXCHANGE" | "BOOTSTRAP" | "REVOKE",
  orderId: unknown,
  tokenId: unknown,
  sessionId: unknown,
) {
  await client.query(
    `INSERT INTO public.order_access_audits(id,order_id,token_id,session_id,action,request_id,correlation_id,task_name,created_at) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::uuid,$7::uuid,$8,clock_timestamp())`,
    [
      randomUUID(),
      orderId,
      tokenId,
      sessionId,
      action,
      trace.requestId,
      trace.correlationId,
      trace.taskName,
    ],
  );
}
