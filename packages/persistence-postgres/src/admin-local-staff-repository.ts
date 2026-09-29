import {
  SUPPORTED_LOCALES,
  adminLocalStaffCommandSchema,
  adminLocalStaffResultSchema,
  adminPermissionKeySchema,
  type AdminStaffFailure,
  type AdminStaffMember,
} from "@fan-support/contracts";
import type { AdminLocalStaffRepository } from "@fan-support/persistence-port";
import { draftRows } from "./content-draft-data.js";
import {
  LOCAL_ISSUER,
  authenticateSession,
  databaseNow,
  holdsPermission,
  lockAccount,
  lockIdentity,
  revokeIdentitySessions,
  revokeRecoveryCodes,
  text,
  writeAudit,
} from "./admin-local-access-data.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";

const failure = (code: AdminStaffFailure["code"]): AdminStaffFailure => ({
  schemaVersion: 1,
  outcome: "FAILURE",
  code,
});
const success = { schemaVersion: 1, outcome: "SUCCESS" } as const;
const MEMBERS = `SELECT a.id,a.version,a.login_name,a.display_name,i.status,i.id AS identity_id,
  a.totp_ciphertext IS NOT NULL AS two_factor,a.must_change_password,
  CASE WHEN a.last_login_at IS NULL THEN NULL ELSE ${text("a.last_login_at")} END AS last_login_at,
  coalesce((SELECT array_agg(r.role_key ORDER BY r.role_key) FROM public.admin_identity_roles ar
    JOIN public.roles r ON r.id=ar.role_id WHERE ar.admin_identity_id=i.id),'{}') AS role_keys
FROM public.admin_local_accounts a JOIN public.admin_identities i ON i.id=a.admin_identity_id
WHERE i.status IN ('ACTIVE','SUSPENDED')`;

/** Staff accounts for holders of `staff.manage`; nobody can suspend or lock out themselves here. */
export function createAdminLocalStaffRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
): AdminLocalStaffRepository {
  const tracked = <T>(work: () => Promise<T>): Promise<T> =>
    scope.trackOperation(async () => {
      try {
        return await work();
      } catch (error) {
        throw persistenceTransactionFailureFromPostgres(error);
      }
    });
  const member = (
    row: Record<string, unknown>,
    actorId: string,
  ): AdminStaffMember => ({
    accountId: String(row["id"]),
    version: Number(row["version"]),
    loginName: String(row["login_name"]),
    displayName: String(row["display_name"]),
    status: row["status"] === "ACTIVE" ? "ACTIVE" : "SUSPENDED",
    twoFactorEnabled: row["two_factor"] === true,
    mustChangePassword: row["must_change_password"] === true,
    roleKeys: row["role_keys"] as string[],
    lastLoginAt: (row["last_login_at"] as string | null) ?? null,
    self: row["identity_id"] === actorId,
  });
  async function readMember(accountId: string, actorId: string) {
    const [row] = await draftRows(client, `${MEMBERS} AND a.id=$1`, [
      accountId,
    ]);
    if (!row) throw new Error("missing staff member");
    return member(row, actorId);
  }
  async function findRoles(keys: readonly string[]) {
    const rows = await draftRows(
      client,
      "SELECT id,role_key FROM public.roles WHERE role_key=ANY($1::text[]) FOR SHARE",
      [keys],
    );
    return rows.length === keys.length
      ? rows.map((row) => String(row["id"]))
      : undefined;
  }
  return {
    execute: (input) =>
      tracked(async () => {
        const parsed = adminLocalStaffCommandSchema.safeParse(input);
        if (!parsed.success) return failure("INVALID_COMMAND");
        const c = parsed.data,
          change = c.change;
        const session = await authenticateSession(client, c);
        if (typeof session === "string") return failure(session);
        const actorId = session.actorId;
        if (!(await holdsPermission(client, actorId, "staff.manage")))
          return failure("FORBIDDEN");
        const actor = { type: "ADMIN", id: actorId } as const;
        const audit = (action: string, accountId: string, at: string) =>
          writeAudit(client, {
            actor,
            action,
            subjectType: "ADMIN_LOCAL_ACCOUNT",
            subjectId: accountId,
            reasonCode: "STAFF_MANAGEMENT",
            requestId: c.requestId,
            correlationId: session.sessionId,
            outcome: "SUCCEEDED",
            at,
          });
        const saved = async (accountId: string) =>
          adminLocalStaffResultSchema.parse({
            ...success,
            kind: "STAFF_SAVED",
            member: await readMember(accountId, actorId),
          });
        if (change.action === "CONTEXT")
          return { ...success, kind: "STAFF_CONTEXT" };
        if (change.action === "LIST") {
          const members = await draftRows(
            client,
            `${MEMBERS} ORDER BY a.created_at,a.login_name LIMIT 500`,
          );
          const roles = await draftRows(
            client,
            `SELECT r.role_key,r.description,coalesce(array_agg(p.permission_key ORDER BY p.permission_key)
              FILTER (WHERE p.permission_key IS NOT NULL),'{}') AS permissions
            FROM public.roles r LEFT JOIN public.role_permissions rp ON rp.role_id=r.id
            LEFT JOIN public.permissions p ON p.id=rp.permission_id
            GROUP BY r.id,r.role_key,r.description ORDER BY r.role_key LIMIT 64`,
          );
          return adminLocalStaffResultSchema.parse({
            ...success,
            kind: "STAFF",
            members: members.map((row) => member(row, actorId)),
            roles: roles.map((row) => ({
              roleKey: row["role_key"],
              description: row["description"],
              permissions: (row["permissions"] as string[]).filter(
                (key) => adminPermissionKeySchema.safeParse(key).success,
              ),
            })),
          });
        }
        if (change.action === "CREATE") {
          const roleIds = await findRoles(change.roleKeys);
          if (!roleIds) return failure("UNKNOWN_ROLE");
          // Serializes concurrent creation of the same name before the uniqueness check.
          await client.query(
            "SELECT pg_advisory_xact_lock(hashtextextended('fan-support:admin-local-login:'||$1,0))",
            [change.loginName],
          );
          const [taken] = await draftRows(
            client,
            "SELECT 1 FROM public.admin_local_accounts WHERE login_name=$1",
            [change.loginName],
          );
          if (taken) return failure("LOGIN_NAME_TAKEN");
          const at = await databaseNow(client);
          await client.query(
            `INSERT INTO public.admin_identities(id,issuer,external_subject_hash,status,mfa_required,created_at,updated_at)
            VALUES($1,$2,$3,'ACTIVE',false,$4::timestamptz,$4::timestamptz)`,
            [
              change.identityId,
              LOCAL_ISSUER,
              Buffer.from(change.subjectDigest, "hex"),
              at,
            ],
          );
          await client.query(
            `INSERT INTO public.admin_local_accounts(id,admin_identity_id,login_name,display_name,password_hash,
              password_changed_at,must_change_password,created_at,updated_at)
            VALUES($1,$2,$3,$4,$5,$6::timestamptz,true,$6::timestamptz,$6::timestamptz)`,
            [
              change.accountId,
              change.identityId,
              change.loginName,
              change.displayName,
              change.passwordHash,
              at,
            ],
          );
          for (const roleId of roleIds)
            await client.query(
              "INSERT INTO public.admin_identity_roles(admin_identity_id,role_id,granted_at,granted_by) VALUES($1,$2,$3::timestamptz,$4)",
              [change.identityId, roleId, at, actorId],
            );
          for (const locale of SUPPORTED_LOCALES)
            for (const grant of [
              [
                "admin_content_locale_grants",
                "CONTENT_LOCALE_GRANT",
                "ADMIN_CONTENT_LOCALE_GRANT",
                "CONTENT_TRANSLATION",
              ],
              [
                "admin_order_message_locale_grants",
                "ORDER_MESSAGE_LOCALE_GRANT",
                "ADMIN_ORDER_MESSAGE_LOCALE_GRANT",
                "SUPPORT_INTENT_PRIVATE",
              ],
            ] as const) {
              const auditId = await writeAudit(client, {
                actor,
                action: grant[1],
                subjectType: grant[2],
                subjectId: change.identityId,
                reasonCode: "STAFF_ACCOUNT_CREATED",
                requestId: c.requestId,
                correlationId: change.accountId,
                outcome: "SUCCEEDED",
                fieldCategory: grant[3],
                at,
              });
              await client.query(
                `INSERT INTO public.${grant[0]}(admin_identity_id,locale,granted_by,granted_at,audit_log_id) VALUES($1,$2,$3,$4::timestamptz,$5)`,
                [change.identityId, locale, actorId, at, auditId],
              );
            }
          await audit("ADMIN_STAFF_CREATED", change.accountId, at);
          return saved(change.accountId);
        }
        const [target] = await draftRows(
          client,
          "SELECT admin_identity_id FROM public.admin_local_accounts WHERE id=$1",
          [change.accountId],
        );
        if (!target) return failure("NOT_FOUND");
        const identityId = String(target["admin_identity_id"]);
        const self = identityId === actorId;
        if (
          self &&
          (change.action === "RESET_PASSWORD" ||
            change.action === "CLEAR_TOTP" ||
            (change.action === "SET_STATUS" && change.status === "SUSPENDED"))
        )
          return failure("SELF_LOCKOUT");
        const status = await lockIdentity(client, identityId);
        const account = await lockAccount(client, change.accountId);
        if (!account || (status !== "ACTIVE" && status !== "SUSPENDED"))
          return failure("NOT_FOUND");
        if (Number(account["version"]) !== change.expectedVersion)
          return failure("STALE_VERSION");
        const at = String(account["at"]);
        const bump = () =>
          client.query(
            "UPDATE public.admin_local_accounts SET version=version+1,updated_at=greatest(updated_at,$2::timestamptz) WHERE id=$1",
            [change.accountId, at],
          );
        const revokeAll = (
          reasonCode:
            "PASSWORD_RESET" | "ACCOUNT_SUSPENDED" | "SECOND_FACTOR_CHANGED",
        ) =>
          revokeIdentitySessions(client, {
            identityId,
            exceptSessionId: null,
            actor,
            reasonCode,
            requestId: c.requestId,
            correlationId: change.accountId,
            at,
          });
        switch (change.action) {
          case "UPDATE_ROLES": {
            const roleIds = await findRoles(change.roleKeys);
            if (!roleIds) return failure("UNKNOWN_ROLE");
            if (self) {
              const kept = await draftRows(
                client,
                `SELECT 1 FROM public.role_permissions rp JOIN public.permissions p ON p.id=rp.permission_id
                WHERE rp.role_id=ANY($1::uuid[]) AND p.permission_key='staff.manage' LIMIT 1`,
                [roleIds],
              );
              if (kept.length === 0) return failure("SELF_LOCKOUT");
            }
            await client.query(
              "DELETE FROM public.admin_identity_roles WHERE admin_identity_id=$1 AND NOT role_id=ANY($2::uuid[])",
              [identityId, roleIds],
            );
            await client.query(
              `INSERT INTO public.admin_identity_roles(admin_identity_id,role_id,granted_at,granted_by)
              SELECT $1,role_id,$3::timestamptz,$4 FROM unnest($2::uuid[]) AS role_id ON CONFLICT DO NOTHING`,
              [identityId, roleIds, at, actorId],
            );
            await bump();
            await audit("ADMIN_STAFF_ROLES_UPDATED", change.accountId, at);
            break;
          }
          case "RESET_PASSWORD":
            await client.query(
              `UPDATE public.admin_local_accounts SET password_hash=$2,password_changed_at=$3::timestamptz,
                must_change_password=true,failed_attempts=0,locked_until=NULL,
                version=version+1,updated_at=greatest(updated_at,$3::timestamptz) WHERE id=$1`,
              [change.accountId, change.passwordHash, at],
            );
            await revokeAll("PASSWORD_RESET");
            await audit("ADMIN_STAFF_PASSWORD_RESET", change.accountId, at);
            break;
          case "CLEAR_TOTP":
            await client.query(
              `UPDATE public.admin_local_accounts SET totp_ciphertext=NULL,totp_encrypted_data_key=NULL,
                totp_key_version=NULL,totp_enabled_at=NULL,totp_last_step=NULL,totp_pending_ciphertext=NULL,
                totp_pending_encrypted_data_key=NULL,totp_pending_key_version=NULL,totp_pending_expires_at=NULL,
                version=version+1,updated_at=greatest(updated_at,$2::timestamptz) WHERE id=$1`,
              [change.accountId, at],
            );
            await revokeRecoveryCodes(client, change.accountId, at);
            await revokeAll("SECOND_FACTOR_CHANGED");
            await audit("ADMIN_STAFF_TOTP_CLEARED", change.accountId, at);
            break;
          case "SET_STATUS":
            if (status === change.status) break;
            await client.query(
              "UPDATE public.admin_identities SET status=$2,version=version+1,updated_at=greatest(updated_at,$3::timestamptz) WHERE id=$1",
              [identityId, change.status, at],
            );
            await bump();
            if (change.status === "SUSPENDED")
              await revokeAll("ACCOUNT_SUSPENDED");
            await audit(
              change.status === "SUSPENDED"
                ? "ADMIN_STAFF_SUSPENDED"
                : "ADMIN_STAFF_REACTIVATED",
              change.accountId,
              at,
            );
            break;
        }
        return saved(change.accountId);
      }),
  };
}
