import { Buffer } from "node:buffer";
import { randomUUID, createHash } from "node:crypto";
/** Safe configuration only: business gifts, prices and inventory are created through their real commands. */
export async function seedGiftCommerceMarket(client, { market, currency }) {
  const id = randomUUID();
  await client.query(
    "INSERT INTO public.markets(id,market,default_currency,status) VALUES($1,$2,$3,'ACTIVE')",
    [id, market, currency],
  );
  return { marketId: id, market, currency };
}
/** Synthetic normal-trigger authority for the independent database harness. */
export async function seedGiftCommerceAuthority(client, { actorId }) {
  const roleId = randomUUID(),
    sessionId = randomUUID();
  const digest = (value) => createHash("sha256").update(value).digest("hex");
  const sessionTokenDigest = digest(randomUUID()),
    csrfTokenDigest = digest(randomUUID());
  await client.query("BEGIN");
  try {
    await client.query(
      "INSERT INTO public.roles(id,role_key,description,created_at) VALUES($1,$2,'Synthetic commerce verification',clock_timestamp()-interval '1 hour')",
      [roleId, `gift-commerce:${roleId}`],
    );
    await client.query(
      "INSERT INTO public.admin_identity_roles(admin_identity_id,role_id,granted_by,granted_at) VALUES($1,$2,$1,clock_timestamp()-interval '1 hour')",
      [actorId, roleId],
    );
    for (const permission of [
      "commerce.read",
      "gift.manage",
      "pricing.manage",
      "inventory.manage",
    ]) {
      const permissionId = randomUUID();
      await client.query(
        "INSERT INTO public.permissions(id,permission_key,description,created_at) VALUES($1,$2,'Synthetic commerce verification',clock_timestamp()-interval '1 hour') ON CONFLICT(permission_key) DO NOTHING",
        [permissionId, permission],
      );
      await client.query(
        "INSERT INTO public.role_permissions(role_id,permission_id,granted_by,granted_at) SELECT $1,id,$3,clock_timestamp()-interval '1 hour' FROM public.permissions WHERE permission_key=$2",
        [roleId, permission, actorId],
      );
    }
    await client.query(
      "INSERT INTO public.admin_sessions(id,admin_identity_id,session_token_digest,csrf_token_digest,authenticated_with_mfa,created_at,expires_at) VALUES($1,$2,$3,$4,true,clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 hour')",
      [
        sessionId,
        actorId,
        Buffer.from(sessionTokenDigest, "hex"),
        Buffer.from(csrfTokenDigest, "hex"),
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return { actorId, sessionId, sessionTokenDigest, csrfTokenDigest };
}
