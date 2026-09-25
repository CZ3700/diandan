import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  SUPPORTED_LOCALES,
  adminSessionPermissionSchema,
} from "@fan-support/contracts";

function permissionsForRole(name, all) {
  switch (name) {
    case "manager":
      return all;
    case "editor":
      return all.filter(
        (key) =>
          !["content.translation.review", "content.publish"].includes(key),
      );
    case "reviewer":
      return [
        "content.read",
        "content.translation.review",
        "content.preview",
        "content.media.read",
      ];
    default:
      return [];
  }
}

/** Only synthetic identities are inserted. Business owners, bytes and drafts use the actual APIs. */
export async function seedWorkspaceIdentities(client, sessions) {
  const identities = Object.fromEntries(
    ["editor", "reviewer", "manager", "denied"].map((name) => [
      name,
      randomUUID(),
    ]),
  );
  const sessionIds = {};
  await client.query("BEGIN");
  try {
    const at = (
      await client.query(
        "SELECT to_char((transaction_timestamp()-interval '10 minutes') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS at",
      )
    ).rows[0].at;
    for (const id of Object.values(identities))
      await client.query(
        "INSERT INTO admin_identities(id,issuer,external_subject_hash,status,created_at) VALUES($1,'local-admin-workspace-fixture',$2,'ACTIVE',$3)",
        [id, createHash("sha256").update(id).digest(), at],
      );
    const permissions = new Map();
    for (const key of adminSessionPermissionSchema.options) {
      const id = randomUUID();
      permissions.set(key, id);
      await client.query(
        "INSERT INTO permissions(id,permission_key,description,created_at) VALUES($1,$2,'Synthetic local workspace permission',$3)",
        [id, key, at],
      );
    }
    for (const [name, actorId] of Object.entries(identities)) {
      const keys = permissionsForRole(name, [...permissions.keys()]);
      const role = randomUUID();
      await client.query(
        "INSERT INTO roles(id,role_key,description,created_at) VALUES($1,$2,'Synthetic local workspace role',$3)",
        [role, `workspace:${name}:${role}`, at],
      );
      await client.query(
        "INSERT INTO admin_identity_roles(admin_identity_id,role_id,granted_by,granted_at) VALUES($1,$2,$3,$4)",
        [actorId, role, identities.manager, at],
      );
      for (const key of keys)
        await client.query(
          "INSERT INTO role_permissions(role_id,permission_id,granted_by,granted_at) VALUES($1,$2,$3,$4)",
          [role, permissions.get(key), identities.manager, at],
        );
      for (const locale of name === "denied" ? [] : SUPPORTED_LOCALES) {
        const audit = randomUUID(),
          request = randomUUID();
        await client.query(
          "INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category,created_at) VALUES($1,'ADMIN',$2,'CONTENT_LOCALE_GRANT','ADMIN_CONTENT_LOCALE_GRANT',$3,'WORKSPACE_FIXTURE',$4,$4,'SUCCEEDED','CONTENT_TRANSLATION',$5)",
          [audit, identities.manager, actorId, request, at],
        );
        await client.query(
          "INSERT INTO admin_content_locale_grants(admin_identity_id,locale,granted_by,audit_log_id,granted_at) VALUES($1,$2,$3,$4,$5)",
          [actorId, locale, identities.manager, audit, at],
        );
      }
    }
    for (const session of sessions) {
      const id = randomUUID();
      sessionIds[session.name] = id;
      await client.query(
        "INSERT INTO admin_sessions(id,admin_identity_id,session_token_digest,csrf_token_digest,authenticated_with_mfa,created_at,expires_at,revoked_at) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+$7*interval '1 second',CASE WHEN $8 THEN clock_timestamp() ELSE NULL END)",
        [
          id,
          identities[session.actor],
          Buffer.from(session.sessionTokenDigest, "hex"),
          Buffer.from(session.csrfTokenDigest, "hex"),
          session.authenticatedWithMfa ?? true,
          at,
          session.expiresInSeconds ?? 3600,
          session.revoked ?? false,
        ],
      );
    }
    await client.query("COMMIT");
    return { identities, sessions: sessionIds };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
export const workspaceTranslations = (fields) =>
  SUPPORTED_LOCALES.map((locale) => ({
    locale,
    origin: "HUMAN",
    fields: fields(locale),
  }));
export const workspaceMediaContent = (label) => ({
  kind: "MEDIA_METADATA",
  structure: {
    presentationKind: "INFORMATIVE",
    focalPoint: { x: 0.5, y: 0.45 },
  },
  translations: workspaceTranslations((locale) => ({
    alt: `${label} · ${locale}`,
    title: label,
  })),
});
export async function createWorkspaceImage(width, height, hue) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="hsl(${hue},36%,22%)"/><stop offset="1" stop-color="hsl(${hue + 40},46%,62%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${width * 0.5}" cy="${height * 0.35}" r="${Math.min(width, height) * 0.2}" fill="#efe3ce" opacity=".85"/><ellipse cx="${width * 0.5}" cy="${height * 0.95}" rx="${width * 0.33}" ry="${height * 0.4}" fill="#262a31"/><circle cx="${width * 0.15}" cy="${height * 0.15}" r="${width * 0.05}" fill="#dac294" opacity=".7"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}
