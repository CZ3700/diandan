// L3-10 acceptance fixtures: what the built-in account server command provisions for the first
// administrator (permission catalog, standard roles, owner with every locale), until ⑦ replaces it.
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import {
  digestAdminLocalIdentitySubject,
  hashAdminPassword,
} from "@fan-support/application";
import {
  SUPPORTED_LOCALES,
  adminPermissionKeySchema,
  adminStandardRolePermissions,
} from "@fan-support/contracts";

export async function provisionFirstAdministrator(
  client,
  { subjectPepper, loginName = "studio.owner", password },
) {
  const accountId = randomUUID(),
    identityId = randomUUID();
  await client.query("BEGIN");
  try {
    for (const key of adminPermissionKeySchema.options)
      await client.query(
        "INSERT INTO permissions(id,permission_key,description) VALUES($1,$2,'Platform permission') ON CONFLICT (permission_key) DO NOTHING",
        [randomUUID(), key],
      );
    await client.query(
      "INSERT INTO roles(id,role_key,description) VALUES($1,'studio:owner','Studio administrator'),($2,'studio:operator','Daily operations'),($3,'studio:broker','Broker')",
      [randomUUID(), randomUUID(), randomUUID()],
    );
    // ADR-022: the owner holds everything except the keys that make an account a broker.
    for (const role of ["studio:owner", "studio:broker"])
      await client.query(
        "INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r JOIN permissions p ON p.permission_key=ANY($2::text[]) WHERE r.role_key=$1",
        [role, adminStandardRolePermissions(role)],
      );
    await client.query(
      "INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r JOIN permissions p ON p.permission_key IN ('content.read','orders.read') WHERE r.role_key='studio:operator'",
    );
    await client.query(
      "INSERT INTO admin_identities(id,issuer,external_subject_hash,status,mfa_required) VALUES($1,'urn:fan-support:local',$2,'ACTIVE',false)",
      [
        identityId,
        Buffer.from(
          digestAdminLocalIdentitySubject(subjectPepper, accountId),
          "hex",
        ),
      ],
    );
    await client.query(
      "INSERT INTO admin_local_accounts(id,admin_identity_id,login_name,display_name,password_hash,password_changed_at,must_change_password) VALUES($1,$2,$3,'Studio Owner',$4,clock_timestamp(),false)",
      [accountId, identityId, loginName, await hashAdminPassword(password)],
    );
    await client.query(
      "INSERT INTO admin_identity_roles(admin_identity_id,role_id,granted_by) SELECT $1,id,$1 FROM roles WHERE role_key='studio:owner'",
      [identityId],
    );
    for (const locale of SUPPORTED_LOCALES) {
      const audit = randomUUID();
      await client.query(
        "INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category) VALUES($1,'ADMIN',$2,'CONTENT_LOCALE_GRANT','ADMIN_CONTENT_LOCALE_GRANT',$2,'FIRST_ADMINISTRATOR',$3,$3,'SUCCEEDED','CONTENT_TRANSLATION')",
        [audit, identityId, randomUUID()],
      );
      await client.query(
        "INSERT INTO admin_content_locale_grants(admin_identity_id,locale,granted_by,audit_log_id) VALUES($1,$2,$1,$3)",
        [identityId, locale, audit],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
  return { accountId, identityId };
}

/** The production administration composition with built-in accounts only and fail-closed media. */
export function localAccountComposition({
  createProductionAdminComposition,
  resolveAdminApiRuntimeConfig,
  createPostgresPersistence,
  database,
  keyManagement,
  adminOrigin,
  accessKey,
  tokenPepper,
  subjectPepper,
  own,
}) {
  const config = resolveAdminApiRuntimeConfig({
    FAN_SUPPORT_ADMIN_ORIGIN: adminOrigin,
    FAN_SUPPORT_ADMIN_ACCESS_KEY: accessKey,
    FAN_SUPPORT_ADMIN_TOKEN_PEPPER: tokenPepper,
    FAN_SUPPORT_ADMIN_SUBJECT_PEPPER: subjectPepper,
    FAN_SUPPORT_ADMIN_LOCAL_ACCOUNTS: "ENABLED",
    FAN_SUPPORT_ADMIN_TOTP_ISSUER: "Studio Admin",
  });
  const unavailable = () => async () => {
    throw new Error("Out-of-scope fixture service requested");
  };
  const persistence = () => {
    const pool = createPostgresPersistence(database, {
      catalogPublicMediaBaseUrl: "https://media.example.invalid",
    });
    own(() => pool.close());
    return pool;
  };
  return {
    config,
    composition: createProductionAdminComposition({
      config,
      resources: {
        persistence,
        paymentConfigurationPersistence: persistence,
        keys: {
          keyManagement,
          activePepperVersion: "test-mac",
          pepperVersions: ["test-mac"],
        },
        media: {
          storage: {
            createUploadGrant: unavailable(),
            createDownloadGrant: unavailable(),
          },
          inspector: { inspect: unavailable() },
          proofProcessor: { process: unavailable() },
          proofReader: { read: unavailable() },
        },
      },
      payment: {
        deployedAccounts: [],
        providerDirectory: { getRegistrations: () => [] },
      },
    }),
  };
}
