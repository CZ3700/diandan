import { randomUUID, createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { seedCatalogDirectoryFixtures } from "./postgres-catalog-fixtures.mjs";

/** Synthetic normal-trigger fixture shared by database and loopback HTTP verification. */
export async function seedAdminContentFixtures(client, options = {}) {
  const catalog =
    options.catalog ?? (await seedCatalogDirectoryFixtures(client, 2));
  const { editor, reviewer } = catalog;
  const denied = randomUUID(),
    idolRevisionId = randomUUID(),
    giftRevisionId = randomUUID();
  const sessions = {};
  await client.query("BEGIN");
  try {
    await client.query(
      "INSERT INTO admin_identities(id,issuer,external_subject_hash,status) VALUES($1,'admin-content-fixture',$2,'ACTIVE')",
      [denied, createHash("sha256").update(denied).digest()],
    );
    const permissionIds = new Map();
    for (const key of [
      "content.read",
      "content.edit",
      "content.translation.review",
      "content.preview",
    ]) {
      const id = randomUUID();
      permissionIds.set(key, id);
      await client.query(
        "INSERT INTO permissions(id,permission_key,description) VALUES($1,$2,'Content test permission')",
        [id, key],
      );
    }
    for (const [identity, keys, locales] of [
      [editor, [...permissionIds.keys()], SUPPORTED_LOCALES],
      [
        reviewer,
        ["content.read", "content.translation.review", "content.preview"],
        options.reviewerLocales ?? SUPPORTED_LOCALES,
      ],
    ]) {
      const role = randomUUID();
      await client.query(
        "INSERT INTO roles(id,role_key,description) VALUES($1,$2,'Content test role')",
        [role, `content-fixture:${role}`],
      );
      await client.query(
        "INSERT INTO admin_identity_roles(admin_identity_id,role_id,granted_by) VALUES($1,$2,$3)",
        [identity, role, editor],
      );
      for (const key of keys)
        await client.query(
          "INSERT INTO role_permissions(role_id,permission_id,granted_by) VALUES($1,$2,$3)",
          [role, permissionIds.get(key), editor],
        );
      for (const locale of locales) {
        const audit = randomUUID(),
          request = randomUUID();
        await client.query(
          `INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category)
          VALUES($1,'ADMIN',$2,'CONTENT_LOCALE_GRANT','ADMIN_CONTENT_LOCALE_GRANT',$3,'FIXTURE_GRANT',$4,$4,'SUCCEEDED','CONTENT_TRANSLATION')`,
          [audit, editor, identity, request],
        );
        await client.query(
          "INSERT INTO admin_content_locale_grants(admin_identity_id,locale,granted_by,audit_log_id) VALUES($1,$2,$3,$4)",
          [identity, locale, editor, audit],
        );
      }
    }
    await client.query(
      `INSERT INTO idol_revisions(id,idol_id,revision,lifecycle,theme_accent,hero_text_tone,display_order,created_by)
      VALUES($1,$2,2,'DRAFT','#D4AF37','light',0,$3)`,
      [idolRevisionId, catalog.idols[0].id, editor],
    );
    await client.query(
      `INSERT INTO gift_revisions(id,gift_id,revision,lifecycle,category,delivery_minimum,delivery_maximum,delivery_unit,requires_safety_notice,shipping_mode,created_by)
      VALUES($1,$2,2,'DRAFT','OTHER',1,2,'DAY',false,'internal_to_idol',$3)`,
      [giftRevisionId, catalog.gifts[0].id, editor],
    );
    for (const session of options.sessions ?? []) {
      const id = randomUUID();
      sessions[session.name] = id;
      const actor = { editor, reviewer, denied }[session.actor];
      if (!actor) throw new Error("invalid test actor");
      await client.query(
        `INSERT INTO admin_sessions(id,admin_identity_id,session_token_digest,csrf_token_digest,authenticated_with_mfa,created_at,expires_at,revoked_at)
        VALUES($1,$2,$3,$4,$5,clock_timestamp()-interval '1 day',clock_timestamp()+$6*interval '1 second',CASE WHEN $7 THEN clock_timestamp() ELSE NULL END)`,
        [
          id,
          actor,
          Buffer.from(session.sessionTokenDigest, "hex"),
          Buffer.from(session.csrfTokenDigest, "hex"),
          session.authenticatedWithMfa ?? true,
          session.expiresInSeconds ?? 3600,
          session.revoked ?? false,
        ],
      );
    }
    await client.query("COMMIT");
    return {
      editor,
      reviewer,
      denied,
      idolRevisionId,
      giftRevisionId,
      catalog,
      sessions,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export function adminAliasDraftFixture(fixtures, options = {}) {
  return {
    schemaVersion: 1,
    id: randomUUID(),
    idolRevisionId: fixtures.idolRevisionId,
    aliases: [{ id: "stage-name", locale: null, text: "Étoile" }],
    actorId: fixtures.editor,
    reasonCode: "CONTENT_CREATED",
    requestId: randomUUID(),
    ...options,
  };
}

export function adminGiftDetailDraftFixture(fixtures, options = {}) {
  return {
    schemaVersion: 1,
    document: {
      schemaVersion: 1,
      id: randomUUID(),
      giftRevisionId: fixtures.giftRevisionId,
      blocks: [{ id: "intro", kind: "PARAGRAPH" }],
    },
    translations: SUPPORTED_LOCALES.map((locale) => ({
      id: randomUUID(),
      locale,
      origin: "HUMAN",
      blocks: [
        {
          blockId: "intro",
          kind: "PARAGRAPH",
          text: `${locale} A thoughtful gift.`,
        },
      ],
    })),
    actorId: fixtures.editor,
    reasonCode: "CONTENT_CREATED",
    requestId: randomUUID(),
    ...options,
  };
}

export async function revokeAdminContentLocaleGrant(
  client,
  { adminIdentityId, locale, actorId },
) {
  await client.query("BEGIN");
  try {
    const grant = (
      await client.query(
        "SELECT id FROM admin_content_locale_grants WHERE admin_identity_id=$1 AND locale=$2 AND revoked_at IS NULL FOR UPDATE",
        [adminIdentityId, locale],
      )
    ).rows[0];
    if (!grant) throw new Error("missing fixture grant");
    const audit = randomUUID(),
      request = randomUUID();
    const now = (
      await client.query(
        "SELECT date_trunc('milliseconds',clock_timestamp()) AS now",
      )
    ).rows[0].now;
    await client.query(
      `INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category,created_at)
      VALUES($1,'ADMIN',$2,'CONTENT_LOCALE_REVOKE','ADMIN_CONTENT_LOCALE_GRANT',$3,'FIXTURE_REVOKE',$4,$4,'SUCCEEDED','CONTENT_TRANSLATION',$5)`,
      [audit, actorId, adminIdentityId, request, now],
    );
    await client.query(
      "UPDATE admin_content_locale_grants SET revoked_at=$1,revoked_audit_log_id=$2 WHERE id=$3",
      [now, audit, grant.id],
    );
    await client.query("COMMIT");
    return grant.id;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function grantAdminContentLocale(
  client,
  { adminIdentityId, locale, actorId },
) {
  await client.query("BEGIN");
  try {
    const audit = randomUUID(),
      request = randomUUID();
    await client.query(
      `INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category)
      VALUES($1,'ADMIN',$2,'CONTENT_LOCALE_GRANT','ADMIN_CONTENT_LOCALE_GRANT',$3,'FIXTURE_GRANT',$4,$4,'SUCCEEDED','CONTENT_TRANSLATION')`,
      [audit, actorId, adminIdentityId, request],
    );
    const result = await client.query(
      "INSERT INTO admin_content_locale_grants(admin_identity_id,locale,granted_by,audit_log_id) VALUES($1,$2,$3,$4) RETURNING id",
      [adminIdentityId, locale, actorId, audit],
    );
    await client.query("COMMIT");
    return result.rows[0].id;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
