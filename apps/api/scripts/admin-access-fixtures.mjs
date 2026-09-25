import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import {
  adminSessionPermissionSchema,
  SUPPORTED_LOCALES,
} from "@fan-support/contracts";
import { digestAdminIdentitySubject } from "@fan-support/application";

/** Synthetic platform grants, deliberately independent of the identity provider's claims. */
export async function seedAdminAccessRoles(client, { issuer, subjectPepper }) {
  const all = [...adminSessionPermissionSchema.options];
  const definitions = {
    daily: [
      ...all.filter(
        (key) =>
          ![
            "content.translation.review",
            "content.policy.manage",
            "content.publish",
          ].includes(key),
      ),
      "management.direct",
    ],
    editor: all.filter(
      (key) =>
        ![
          "content.translation.review",
          "content.policy.manage",
          "content.publish",
        ].includes(key),
    ),
    reviewer: [
      "content.read",
      "content.translation.review",
      "content.preview",
      "content.media.read",
    ],
    order: [],
    manager: [...all, "management.direct"],
    developer: [],
  };
  const actors = Object.fromEntries(
    Object.keys(definitions).map((key) => [
      key,
      {
        id: randomUUID(),
        subject: randomUUID(),
        roleId: randomUUID(),
        permissions: definitions[key],
        locales: key === "reviewer" ? ["ja"] : SUPPORTED_LOCALES,
      },
    ]),
  );
  const permissions = new Map();
  await client.query("BEGIN");
  try {
    for (const actor of Object.values(actors))
      await client.query(
        "INSERT INTO admin_identities(id,issuer,external_subject_hash,status) VALUES($1,$2,$3,'ACTIVE')",
        [
          actor.id,
          issuer,
          Buffer.from(
            digestAdminIdentitySubject({
              subjectPepper,
              issuer,
              subject: actor.subject,
            }),
            "hex",
          ),
        ],
      );
    for (const key of [...all, "management.direct"]) {
      const id = randomUUID();
      permissions.set(key, id);
      await client.query(
        "INSERT INTO permissions(id,permission_key,description) VALUES($1,$2,'Local identity acceptance permission')",
        [id, key],
      );
    }
    for (const [key, actor] of Object.entries(actors)) {
      await client.query(
        "INSERT INTO roles(id,role_key,description) VALUES($1,$2,'Local identity acceptance role')",
        [actor.roleId, `access:${key}`],
      );
      await client.query(
        "INSERT INTO admin_identity_roles(admin_identity_id,role_id,granted_by) VALUES($1,$2,$3)",
        [actor.id, actor.roleId, actors.manager.id],
      );
      for (const permission of actor.permissions)
        await client.query(
          "INSERT INTO role_permissions(role_id,permission_id,granted_by) VALUES($1,$2,$3)",
          [actor.roleId, permissions.get(permission), actors.manager.id],
        );
      for (const locale of actor.locales) {
        const audit = randomUUID(),
          request = randomUUID();
        await client.query(
          "INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category) VALUES($1,'ADMIN',$2,'CONTENT_LOCALE_GRANT','ADMIN_CONTENT_LOCALE_GRANT',$3,'LOCAL_ACCEPTANCE',$4,$4,'SUCCEEDED','CONTENT_TRANSLATION')",
          [audit, actors.manager.id, actor.id, request],
        );
        await client.query(
          "INSERT INTO admin_content_locale_grants(admin_identity_id,locale,granted_by,audit_log_id) VALUES($1,$2,$3,$4)",
          [actor.id, locale, actors.manager.id, audit],
        );
      }
    }
    await client.query("COMMIT");
    return { actors, permissions };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
