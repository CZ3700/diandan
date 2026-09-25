import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomBytes, randomUUID } from "node:crypto";
import { digestAdminContentToken } from "@fan-support/application";
import { createStorefrontContentClient } from "./storefront-content-client.mjs";

/** Same synthetic independent staff method as initial policy setup; no role or permission bypass. */
export async function withLocalHomepageSessions(
  { client, config, base, saveSessionIds },
  action,
) {
  if (config.environment !== "LOCAL_TEST")
    throw new Error("Homepage sessions require local TEST");
  const actors = config.services.oidc.actors;
  assert.equal(new Set(actors.map((actor) => actor.key)).size, 2);
  assert.equal(new Set(actors.map((actor) => actor.id)).size, 2);
  const sessionIds = actors.map(() => randomUUID()),
    credentials = {};
  // Save ownership before insertion, so a process crash cannot leave an untracked temporary session.
  await saveSessionIds(sessionIds);
  try {
    for (const [index, actor] of actors.entries()) {
      const value = {
        token: randomBytes(32).toString("base64url"),
        csrf: randomBytes(32).toString("base64url"),
      };
      credentials[actor.key] = value;
      const digest = (purpose, token) =>
        Buffer.from(
          digestAdminContentToken({
            tokenPepper: Buffer.from(
              config.secrets.tokenPepper,
              "base64url",
            ).toString("hex"),
            purpose,
            token,
          }),
          "hex",
        );
      await client.query(
        "INSERT INTO admin_sessions(id,admin_identity_id,session_token_digest,csrf_token_digest,authenticated_with_mfa,expires_at) VALUES($1,$2,$3,$4,true,clock_timestamp()+interval '5 minutes')",
        [
          sessionIds[index],
          actor.id,
          digest("admin-session", value.token),
          digest("admin-csrf", value.csrf),
        ],
      );
    }
    credentials.editor = credentials.manager;
    const content = createStorefrontContentClient({
      base,
      origin: config.origins.admin,
      credentials,
      check: assert.ok,
    });
    return await action(content);
  } finally {
    await client.query(
      "UPDATE admin_sessions SET revoked_at=clock_timestamp() WHERE id=ANY($1::uuid[]) AND revoked_at IS NULL",
      [sessionIds],
    );
    await saveSessionIds([]);
  }
}
