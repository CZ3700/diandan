import { randomUUID } from "node:crypto";
import { seedContentAuthoringFixtures } from "./postgres-content-authoring-fixtures.mjs";

/** Synthetic permissions and content are inserted through their ordinary database constraints. */
export async function seedResourceManagementFixtures(client, options = {}) {
  const fixtures = await seedContentAuthoringFixtures(client, options);
  const permissions = [
    "content.media.upload",
    "content.media.read",
    "content.media.process",
    "content.media.rights",
    "content.policy.manage",
  ];
  await client.query("BEGIN");
  try {
    const permissionIds = new Map();
    for (const key of permissions) {
      const id = randomUUID();
      await client.query(
        "INSERT INTO public.permissions(id,permission_key,description,created_at) VALUES($1,$2,'Resource fixture permission',coalesce($3::timestamptz,transaction_timestamp()))",
        [id, key, options.resourceCreatedAt ?? null],
      );
      permissionIds.set(key, id);
    }
    for (const actor of ["editor", "reviewer"]) {
      const keys =
        options.resourcePermissions?.[actor] ??
        (actor === "editor" ? permissions : ["content.media.read"]);
      const role = randomUUID();
      await client.query(
        "INSERT INTO public.roles(id,role_key,description,created_at) VALUES($1,$2,'Resource fixture role',coalesce($3::timestamptz,transaction_timestamp()))",
        [role, `resource-fixture:${role}`, options.resourceCreatedAt ?? null],
      );
      await client.query(
        "INSERT INTO public.admin_identity_roles(admin_identity_id,role_id,granted_by,granted_at) VALUES($1,$2,$3,coalesce($4::timestamptz,transaction_timestamp()))",
        [
          fixtures[actor],
          role,
          fixtures.editor,
          options.resourceCreatedAt ?? null,
        ],
      );
      for (const key of keys) {
        if (!permissionIds.has(key))
          throw new Error("Unknown resource fixture permission");
        await client.query(
          "INSERT INTO public.role_permissions(role_id,permission_id,granted_by,granted_at) VALUES($1,$2,$3,coalesce($4::timestamptz,transaction_timestamp()))",
          [
            role,
            permissionIds.get(key),
            fixtures.editor,
            options.resourceCreatedAt ?? null,
          ],
        );
      }
    }
    await client.query("COMMIT");
    return fixtures;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
