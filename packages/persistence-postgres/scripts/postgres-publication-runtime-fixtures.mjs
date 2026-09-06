import { randomUUID } from "node:crypto";
import { seedPublicationPreflightFixtures } from "./postgres-publication-preflight-fixtures.mjs";

/** Seed on migration 0017, then upgrade to 0018; no new-publication legacy bypass. */
export async function seedPublicationRuntimeFixtures(
  client,
  persistence,
  options = {},
) {
  const fixtures = await seedPublicationPreflightFixtures(
    client,
    persistence,
    options,
  );
  await client.query("BEGIN");
  try {
    const permission = randomUUID(),
      role = randomUUID();
    await client.query(
      "INSERT INTO public.permissions(id,permission_key,description) VALUES($1,'content.publish','Synthetic publication permission')",
      [permission],
    );
    await client.query(
      "INSERT INTO public.roles(id,role_key,description) VALUES($1,$2,'Synthetic publication role')",
      [role, `publication-fixture:${role}`],
    );
    await client.query(
      "INSERT INTO public.role_permissions(role_id,permission_id,granted_by) VALUES($1,$2,$3)",
      [role, permission, fixtures.editor],
    );
    await client.query(
      "INSERT INTO public.admin_identity_roles(admin_identity_id,role_id,granted_by) VALUES($1,$2,$1)",
      [fixtures.editor, role],
    );
    await client.query("COMMIT");
    return fixtures;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
