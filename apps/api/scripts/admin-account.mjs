#!/usr/bin/env node
// ADR-021 / L3-10 ⑦: server command for built-in admin accounts — the first administrator and
// emergency access. Passwords are read from standard input or an echo-free prompt only; they never
// appear in arguments, shell history or output. Every change is audited as SYSTEM admin-account-cli.
//
//   node apps/api/scripts/admin-account.mjs <command> [--instance <name>] [options]
//     create --login <name> --name <display name> [--role studio:owner|studio:operator] [--password-stdin]
//     reset-password --login <name> [--password-stdin]
//     clear-2fa --login <name>
//     suspend --login <name>
//     reactivate --login <name>
//     list
//
// Without --instance the database comes from FAN_SUPPORT_DATABASE_URL and the identity key from
// FAN_SUPPORT_ADMIN_SUBJECT_PEPPER, as for the API.
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import {
  adminPasswordProblem,
  digestAdminLocalIdentitySubject,
  hashAdminPassword,
} from "@fan-support/application";
import {
  SUPPORTED_LOCALES,
  adminLoginNameSchema,
  adminPermissionKeySchema,
} from "@fan-support/contracts";

const TASK = "admin-account-cli";
export const OWNER_ROLE = "studio:owner";
export const OPERATOR_ROLE = "studio:operator";
/** Design §6: daily operations have no finance, payment configuration, replay or staff management. */
const OPERATOR_EXCLUDED = new Set([
  "orders.manage",
  "finance.manage",
  "payments.configure",
  "payments.review",
  "payments.publish",
  "exceptions.replay",
  "staff.manage",
]);

async function audit(client, input) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO audit_logs(id,actor_type,actor_id,task_name,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'SUCCEEDED',$11,$12::timestamptz)`,
    [
      id,
      input.actorId ? "ADMIN" : "SYSTEM",
      input.actorId ?? null,
      input.actorId ? null : TASK,
      input.action,
      input.subjectType,
      input.subjectId,
      input.reasonCode,
      input.requestId,
      input.correlationId ?? null,
      input.fieldCategory ?? null,
      input.at,
    ],
  );
  return id;
}
async function now(client) {
  return (
    await client.query(
      `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`,
    )
  ).rows[0].at;
}

/** Idempotently completes the permission catalog and the two standard roles (migration 0054 left them to this command). */
export async function ensureStandardRoles(client) {
  for (const key of adminPermissionKeySchema.options)
    await client.query(
      "INSERT INTO permissions(id,permission_key,description) VALUES($1,$2,'Platform permission') ON CONFLICT (permission_key) DO NOTHING",
      [randomUUID(), key],
    );
  await client.query(
    `INSERT INTO roles(id,role_key,description) VALUES
      ($1,$3,'Studio administrator: every permission, including staff, finance and payment configuration'),
      ($2,$4,'Daily operations: content, gifts, orders and messages; no finance, payment configuration, exception replay or staff management')
    ON CONFLICT (role_key) DO NOTHING`,
    [randomUUID(), randomUUID(), OWNER_ROLE, OPERATOR_ROLE],
  );
  const catalog = [...adminPermissionKeySchema.options];
  for (const [role, keys] of [
    [OWNER_ROLE, catalog],
    [OPERATOR_ROLE, catalog.filter((key) => !OPERATOR_EXCLUDED.has(key))],
  ])
    await client.query(
      `INSERT INTO role_permissions(role_id,permission_id)
      SELECT r.id,p.id FROM roles r JOIN permissions p ON p.permission_key=ANY($2::text[])
      WHERE r.role_key=$1 ON CONFLICT DO NOTHING`,
      [role, keys],
    );
}

async function lockedAccount(client, loginName) {
  const [row] = (
    await client.query(
      `SELECT a.id,a.admin_identity_id,a.version,i.status FROM admin_local_accounts a
      JOIN admin_identities i ON i.id=a.admin_identity_id WHERE a.login_name=$1`,
      [loginName],
    )
  ).rows;
  if (!row) throw new Error("No built-in account has that login name");
  await client.query("SELECT 1 FROM admin_identities WHERE id=$1 FOR UPDATE", [
    row.admin_identity_id,
  ]);
  await client.query(
    "SELECT 1 FROM admin_local_accounts WHERE id=$1 FOR UPDATE",
    [row.id],
  );
  return row;
}
async function revokeSessions(client, identityId, reasonCode, context) {
  const revoked = (
    await client.query(
      `UPDATE admin_sessions SET revoked_at=$2::timestamptz
      WHERE admin_identity_id=$1 AND revoked_at IS NULL AND expires_at>$2::timestamptz
        AND created_at<=$2::timestamptz RETURNING id`,
      [identityId, context.at],
    )
  ).rows;
  for (const session of revoked)
    await audit(client, {
      action: "ADMIN_SESSIONS_REVOKED",
      subjectType: "ADMIN_SESSION",
      subjectId: session.id,
      reasonCode,
      requestId: context.requestId,
      correlationId: context.accountId,
      at: context.at,
    });
  return revoked.length;
}

/** One command in one transaction. `readPassword` is asked only by commands that need a password. */
export async function runAdminAccountCommand({
  client,
  subjectPepper,
  command,
  options,
  readPassword,
}) {
  const requestId = randomUUID();
  const loginName = () => {
    const parsed = adminLoginNameSchema.safeParse(
      String(options.login ?? "")
        .trim()
        .toLowerCase(),
    );
    if (!parsed.success)
      throw new Error("--login must be 3–64 lowercase letters, digits, . _ -");
    return parsed.data;
  };
  const newPassword = async (name) => {
    const password = await readPassword();
    const problem = adminPasswordProblem(password, name);
    if (problem) throw new Error(`Password rejected: ${problem}`);
    return hashAdminPassword(password);
  };
  if (command === "list") {
    const rows = (
      await client.query(
        `SELECT a.login_name,a.display_name,i.status,a.totp_ciphertext IS NOT NULL AS two_factor,
          a.must_change_password,a.locked_until>clock_timestamp() AS locked,a.last_login_at,
          coalesce((SELECT array_agg(r.role_key ORDER BY r.role_key) FROM admin_identity_roles ar
            JOIN roles r ON r.id=ar.role_id WHERE ar.admin_identity_id=i.id),'{}') AS roles
        FROM admin_local_accounts a JOIN admin_identities i ON i.id=a.admin_identity_id
        ORDER BY a.created_at`,
      )
    ).rows;
    return rows.map((row) => ({
      loginName: row.login_name,
      displayName: row.display_name,
      status: row.status,
      twoFactor: row.two_factor,
      mustChangePassword: row.must_change_password,
      locked: row.locked === true,
      roles: row.roles,
      lastLoginAt: row.last_login_at,
    }));
  }
  const name = loginName();
  if (command === "create") {
    const role = options.role ?? OWNER_ROLE;
    if (![OWNER_ROLE, OPERATOR_ROLE].includes(role))
      throw new Error(`--role must be ${OWNER_ROLE} or ${OPERATOR_ROLE}`);
    const displayName = String(options.name ?? "").trim();
    if (
      [...displayName].length < 1 ||
      [...displayName].length > 80 ||
      /\p{Cc}/u.test(displayName)
    )
      throw new Error("--name must be 1–80 characters");
    const passwordHash = await newPassword(name);
    await client.query("BEGIN");
    try {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('fan-support:admin-local-login:'||$1,0))",
        [name],
      );
      if (
        (
          await client.query(
            "SELECT 1 FROM admin_local_accounts WHERE login_name=$1",
            [name],
          )
        ).rows.length
      )
        throw new Error("That login name is already in use");
      await ensureStandardRoles(client);
      const accountId = randomUUID(),
        identityId = randomUUID();
      const at = await now(client);
      await client.query(
        `INSERT INTO admin_identities(id,issuer,external_subject_hash,status,mfa_required,created_at,updated_at)
        VALUES($1,'urn:fan-support:local',$2,'ACTIVE',false,$3::timestamptz,$3::timestamptz)`,
        [
          identityId,
          Buffer.from(
            digestAdminLocalIdentitySubject(subjectPepper, accountId),
            "hex",
          ),
          at,
        ],
      );
      await client.query(
        `INSERT INTO admin_local_accounts(id,admin_identity_id,login_name,display_name,password_hash,
          password_changed_at,must_change_password,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6::timestamptz,false,$6::timestamptz,$6::timestamptz)`,
        [accountId, identityId, name, displayName, passwordHash, at],
      );
      await client.query(
        "INSERT INTO admin_identity_roles(admin_identity_id,role_id,granted_at) SELECT $1,id,$2::timestamptz FROM roles WHERE role_key=$3",
        [identityId, at, role],
      );
      // Language grants are audited as an administrator; the new account grants its own.
      for (const locale of SUPPORTED_LOCALES)
        for (const [table, action, subjectType, fieldCategory] of [
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
        ]) {
          const auditId = await audit(client, {
            actorId: identityId,
            action,
            subjectType,
            subjectId: identityId,
            reasonCode: "ADMIN_ACCOUNT_CLI",
            requestId,
            correlationId: accountId,
            fieldCategory,
            at,
          });
          await client.query(
            `INSERT INTO ${table}(admin_identity_id,locale,granted_by,granted_at,audit_log_id) VALUES($1,$2,$1,$3::timestamptz,$4)`,
            [identityId, locale, at, auditId],
          );
        }
      await audit(client, {
        action: "ADMIN_LOCAL_ACCOUNT_CREATED",
        subjectType: "ADMIN_LOCAL_ACCOUNT",
        subjectId: accountId,
        reasonCode: "ADMIN_ACCOUNT_CLI",
        requestId,
        at,
      });
      await client.query("COMMIT");
      return { created: name, role };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }
  if (
    !["reset-password", "clear-2fa", "suspend", "reactivate"].includes(command)
  )
    throw new Error(
      "Use create, reset-password, clear-2fa, suspend, reactivate or list",
    );
  const passwordHash =
    command === "reset-password" ? await newPassword(name) : undefined;
  await client.query("BEGIN");
  try {
    const account = await lockedAccount(client, name);
    const at = await now(client);
    const context = { at, requestId, accountId: account.id };
    const bump = (sets, values = []) =>
      client.query(
        `UPDATE admin_local_accounts SET ${sets}version=version+1,updated_at=greatest(updated_at,$2::timestamptz) WHERE id=$1`,
        [account.id, at, ...values],
      );
    let revoked = 0,
      action;
    if (command === "reset-password") {
      await bump(
        "password_hash=$3,password_changed_at=$2::timestamptz,must_change_password=false,failed_attempts=0,locked_until=NULL,",
        [passwordHash],
      );
      revoked = await revokeSessions(
        client,
        account.admin_identity_id,
        "PASSWORD_RESET",
        context,
      );
      action = "ADMIN_LOCAL_PASSWORD_RESET";
    } else if (command === "clear-2fa") {
      await bump(
        "totp_ciphertext=NULL,totp_encrypted_data_key=NULL,totp_key_version=NULL,totp_enabled_at=NULL,totp_last_step=NULL,totp_pending_ciphertext=NULL,totp_pending_encrypted_data_key=NULL,totp_pending_key_version=NULL,totp_pending_expires_at=NULL,",
      );
      await client.query(
        "UPDATE admin_local_recovery_codes SET revoked_at=$2::timestamptz WHERE account_id=$1 AND used_at IS NULL AND revoked_at IS NULL",
        [account.id, at],
      );
      revoked = await revokeSessions(
        client,
        account.admin_identity_id,
        "SECOND_FACTOR_CHANGED",
        context,
      );
      action = "ADMIN_LOCAL_TOTP_CLEARED";
    } else {
      const status = command === "suspend" ? "SUSPENDED" : "ACTIVE";
      await client.query(
        "UPDATE admin_identities SET status=$2,version=version+1,updated_at=greatest(updated_at,$3::timestamptz) WHERE id=$1",
        [account.admin_identity_id, status, at],
      );
      await bump(
        command === "reactivate" ? "failed_attempts=0,locked_until=NULL," : "",
      );
      if (status === "SUSPENDED")
        revoked = await revokeSessions(
          client,
          account.admin_identity_id,
          "ACCOUNT_SUSPENDED",
          context,
        );
      action =
        status === "SUSPENDED"
          ? "ADMIN_LOCAL_ACCOUNT_SUSPENDED"
          : "ADMIN_LOCAL_ACCOUNT_REACTIVATED";
    }
    await audit(client, {
      action,
      subjectType: "ADMIN_LOCAL_ACCOUNT",
      subjectId: account.id,
      reasonCode: "ADMIN_ACCOUNT_CLI",
      requestId,
      at,
    });
    await client.query("COMMIT");
    return { [command]: name, sessionsSignedOut: revoked };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

/** Reads a password from standard input (piped) or an echo-free prompt asked twice. */
async function readPasswordFrom(stdinOnly) {
  if (stdinOnly || !process.stdin.isTTY) {
    if (!stdinOnly)
      throw new Error(
        "Use --password-stdin when standard input is not a terminal",
      );
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    return text.replace(/\r?\n$/u, "");
  }
  const ask = (label) =>
    new Promise((resolve, reject) => {
      process.stderr.write(label);
      const input = process.stdin;
      let value = "";
      input.setRawMode(true);
      input.resume();
      input.setEncoding("utf8");
      const done = (error) => {
        input.setRawMode(false);
        input.pause();
        input.off("data", onData);
        process.stderr.write("\n");
        if (error) reject(error);
        else resolve(value);
      };
      const onData = (chunk) => {
        for (const character of chunk) {
          if (character === "\r" || character === "\n") return done();
          if (character === "\u0003") return done(new Error("Canceled"));
          if (character === "\u007f" || character === "\b")
            value = [...value].slice(0, -1).join("");
          else value += character;
        }
      };
      input.on("data", onData);
    });
  const first = await ask("Password: ");
  const second = await ask("Repeat password: ");
  if (first !== second) throw new Error("The two passwords differ");
  return first;
}

async function connect(options) {
  if (options.instance) {
    const workspaceRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../..",
    );
    const config = JSON.parse(
      await readFile(
        path.join(
          workspaceRoot,
          "node_modules/.cache/fan-support-local-experience",
          options.instance,
          "config.json",
        ),
        "utf8",
      ),
    );
    return {
      client: new Client({
        host: "127.0.0.1",
        port: config.ports.postgres,
        user: config.database.user,
        password: config.database.password,
        database: config.database.database,
      }),
      subjectPepper: Buffer.from(
        config.secrets.subjectPepper,
        "base64url",
      ).toString("hex"),
    };
  }
  const url = process.env["FAN_SUPPORT_DATABASE_URL"];
  const pepper = process.env["FAN_SUPPORT_ADMIN_SUBJECT_PEPPER"];
  if (!url || !pepper)
    throw new Error(
      "Set --instance, or FAN_SUPPORT_DATABASE_URL and FAN_SUPPORT_ADMIN_SUBJECT_PEPPER",
    );
  return {
    client: new Client({ connectionString: url }),
    subjectPepper: pepper,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index];
    if (flag === "--password-stdin") options.passwordStdin = true;
    else if (
      ["--instance", "--login", "--name", "--role"].includes(flag) &&
      rest[index + 1] !== undefined
    )
      options[flag.slice(2)] = rest[++index];
    else {
      console.error(`Unknown option ${flag}`);
      process.exit(2);
    }
  }
  let client;
  try {
    const connection = await connect(options);
    client = connection.client;
    await client.connect();
    const result = await runAdminAccountCommand({
      client,
      subjectPepper: connection.subjectPepper,
      command,
      options,
      readPassword: () => readPasswordFrom(options.passwordStdin === true),
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    // Messages are our own; a database error is reported by its SQLSTATE only.
    console.error(
      error?.code && /^[0-9A-Z]{5}$/u.test(error.code)
        ? `Database refused the change (${error.code})`
        : String(error?.message ?? error),
    );
    process.exitCode = 1;
  } finally {
    await client?.end().catch(() => undefined);
  }
}
