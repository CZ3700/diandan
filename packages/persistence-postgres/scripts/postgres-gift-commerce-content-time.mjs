import { randomBytes, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { Pool } from "pg";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { createGiftCommerceUseCases } from "../../application/dist/gift-commerce.js";
import { digestAdminContentToken } from "../../application/dist/admin-content-tokens.js";
import { createPostgresPersistenceWithPoolFactory } from "../dist/postgres-persistence.js";
import { grantAdminContentLocale } from "./postgres-admin-content-fixtures.mjs";

/** Only the earlier content-authorization observation is advanced; all validity predicates and triggers remain real. */
export async function verifyGiftCommerceContentTime({
  client,
  config,
  actorId,
  check,
}) {
  const tokenPepper = randomBytes(32).toString("hex");
  const sessionToken = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(32).toString("base64url");
  const digest = (purpose, token) =>
    Buffer.from(
      digestAdminContentToken({ tokenPepper, purpose, token }),
      "hex",
    );
  const roleId = randomUUID();
  await client.query("BEGIN");
  try {
    await client.query(
      "INSERT INTO public.roles(id,role_key,description,created_at) VALUES($1,$2,'Synthetic content time verification',clock_timestamp()-interval '1 hour')",
      [roleId, `content-time:${roleId}`],
    );
    await client.query(
      "INSERT INTO public.permissions(id,permission_key,description,created_at) VALUES($1,'content.edit','Synthetic content time verification',clock_timestamp()-interval '1 hour') ON CONFLICT(permission_key) DO NOTHING",
      [randomUUID()],
    );
    await client.query(
      "INSERT INTO public.admin_identity_roles(admin_identity_id,role_id,granted_by,granted_at) VALUES($1,$2,$1,clock_timestamp()-interval '1 hour')",
      [actorId, roleId],
    );
    await client.query(
      "INSERT INTO public.role_permissions(role_id,permission_id,granted_by,granted_at) SELECT $1,id,$2,clock_timestamp()-interval '1 hour' FROM public.permissions WHERE permission_key='content.edit'",
      [roleId, actorId],
    );
    await client.query(
      "INSERT INTO public.admin_sessions(id,admin_identity_id,session_token_digest,csrf_token_digest,authenticated_with_mfa,created_at,expires_at) VALUES($1,$2,$3,$4,true,clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 hour')",
      [
        randomUUID(),
        actorId,
        digest("admin-session", sessionToken),
        digest("admin-csrf", csrfToken),
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  for (const locale of SUPPORTED_LOCALES) {
    const { rowCount } = await client.query(
      "SELECT id FROM public.admin_content_locale_grants WHERE admin_identity_id=$1 AND locale=$2 AND revoked_at IS NULL",
      [actorId, locale],
    );
    if (rowCount === 0)
      await grantAdminContentLocale(client, {
        adminIdentityId: actorId,
        actorId,
        locale,
      });
  }
  let observations = 0;
  const persistence = createPostgresPersistenceWithPoolFactory(
    config,
    {},
    (db) => {
      const pool = new Pool(db);
      return {
        end: () => pool.end(),
        on: (...args) => pool.on(...args),
        off: (...args) => pool.off(...args),
        connect: async () => {
          const connection = await pool.connect();
          return {
            release: (value) => connection.release(value),
            query: async (sql, values) => {
              const text = typeof sql === "string" ? sql : sql.text;
              const selected = text.includes(
                "to_char(instant.now AT TIME ZONE 'UTC'",
              );
              const statement = selected
                ? text.replace(
                    "to_char(instant.now AT TIME ZONE 'UTC'",
                    "to_char((instant.now+interval '2 seconds') AT TIME ZONE 'UTC'",
                  )
                : text;
              if (selected) observations++;
              try {
                return await connection.query(
                  statement === text
                    ? sql
                    : typeof sql === "string"
                      ? statement
                      : { ...sql, text: statement },
                  values,
                );
              } catch (error) {
                console.error(
                  JSON.stringify({
                    probe: "CONTENT_AUTHORIZATION_CLOCK",
                    phase: text === "COMMIT" ? "COMMIT" : "STATEMENT",
                    sqlstate: /^[A-Z0-9]{5}$/u.test(error.code ?? "")
                      ? error.code
                      : "NONE",
                    guard:
                      error.constraint === "gift_commerce_session"
                        ? "GIFT_COMMERCE_SESSION"
                        : "OTHER",
                  }),
                );
                throw error;
              }
            },
          };
        },
      };
    },
    { catalogPublicMediaBaseUrl: "https://media.example.test" },
  );
  try {
    const {
      rows: [owner],
    } = await client.query(
      "SELECT g.id,g.version,g.published_revision_id FROM public.gifts g WHERE g.status='active' AND g.published_revision_id IS NOT NULL ORDER BY g.id LIMIT 1",
    );
    const source =
      await persistence.giftCommerceTransactionManager.runInGiftCommerceTransaction(
        (repositories) =>
          repositories.contentAuthoring.read({
            schemaVersion: 1,
            action: "READ",
            target: { kind: "GIFT", giftId: owner.id },
            revisionId: owner.published_revision_id,
          }),
      );
    check(
      source.outcome,
      "SUCCESS",
      "content clock probe loads canonical immutable source",
    );
    const translated = source.snapshot.content.translations.find(
      (row) => row.locale === "ja",
    );
    const useCases = createGiftCommerceUseCases({
      transactions: persistence.giftCommerceTransactionManager,
      tokenPepper,
    });
    const result = await useCases.execute({
      schemaVersion: 1,
      requestId: randomUUID(),
      sessionToken,
      csrfToken,
      command: {
        schemaVersion: 1,
        action: "SAVE_GIFT_CONTENT",
        expectedBaseVersion: Number(owner.version),
        giftKind: "OTHER",
        reasonCode: "CONTENT_TIME_BOUNDARY",
        idempotencyKey: randomUUID(),
        authoring: {
          schemaVersion: 1,
          action: "COPY",
          target: source.snapshot.target,
          expectedVersion: source.snapshot.headVersion,
          sourceRevisionId: source.snapshot.revisionId,
          expectedSourceHash: source.snapshot.contentHash,
          changes: {
            kind: "GIFT",
            translations: [
              {
                locale: translated.locale,
                fields: translated.fields,
                origin: "HUMAN",
              },
            ],
          },
        },
      },
    });
    console.log(
      JSON.stringify({
        probe: "CONTENT_AUTHORIZATION_CLOCK",
        observations,
        outcome: result.outcome,
        code: result.outcome === "FAILURE" ? result.code : "NONE",
      }),
    );
    check(
      observations,
      2,
      "both actual content authorization observations are advanced without changing validity checks",
    );
    check(
      result.outcome,
      "SUCCESS",
      "actual App gift save retains its stable commerce event authority",
    );
  } finally {
    await persistence.close();
  }
}
