#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client, Pool } from "pg";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { withNativeFinancePostgres } from "../../../apps/api/scripts/admin-finance-native-postgres.mjs";
import {
  loadMigrationManifest,
  captureDatabaseCatalog,
  withEphemeralPostgres,
} from "../dist/index.js";
import { runMigrationCommandOnSession } from "../dist/migrations/runner.js";
import { createPostgresPersistenceWithPoolFactory } from "../dist/postgres-persistence.js";
import { verifyPaymentConfigurationCopies } from "./admin-payment-configuration-copy-cases.mjs";
import { verifyPaymentConfigurationDocument } from "./admin-payment-configuration-document-cases.mjs";
import { verifyPaymentConfigurationStorage } from "./admin-payment-configuration-storage-cases.mjs";
import { verifyPaymentConfigurationCapacity } from "./admin-payment-configuration-capacity-cases.mjs";
import { verifyPaymentConfigurationUuid } from "./admin-payment-configuration-uuid-cases.mjs";
const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const args = process.argv.slice(2),
  nativeIndex = args.indexOf("--native-bin");
const binDirectory = nativeIndex < 0 ? null : args[nativeIndex + 1];
const harness = binDirectory
  ? (work) => withNativeFinancePostgres(work, { binDirectory })
  : withEphemeralPostgres;
let checks = 0,
  stage = "migrations";
const check = (condition, label) => {
  assert.ok(condition, label);
  checks++;
};
await harness(async (database) => {
  const client = new Client(database);
  await client.connect();
  const migrationSession = {
    query: async (text, values = []) => {
      try {
        return await client.query(text, [...values]);
      } catch (error) {
        console.error(
          JSON.stringify({
            stage: "migration",
            code: error.code,
            position: error.position,
            message: error.message,
          }),
        );
        throw error;
      }
    },
  };
  const capture = () =>
    captureDatabaseCatalog({
      query: async (text, values = []) => ({
        rows: (await client.query(text, [...values])).rows,
      }),
    });
  try {
    const migrations = await loadMigrationManifest({ workspaceRoot });
    await runMigrationCommandOnSession(migrationSession, migrations, {
      direction: "up",
      targetVersion: "0036",
    });
    const before = await capture();
    await runMigrationCommandOnSession(migrationSession, migrations, {
      direction: "down",
      confirmVersion: "0036",
    });
    await runMigrationCommandOnSession(migrationSession, migrations, {
      direction: "up",
      targetVersion: "0036",
    });
    assert.deepEqual(
      await capture(),
      before,
      "up/down/up catalog is identical",
    );
    checks++;
    await runMigrationCommandOnSession(migrationSession, migrations, {
      direction: "up",
    });
  } catch (error) {
    await client.end();
    console.error(
      JSON.stringify({
        stage: "migration",
        name: error.name,
        message: error.message,
      }),
    );
    throw error;
  }
  const makePersistence = () =>
    createPostgresPersistenceWithPoolFactory(database, {}, (configuration) => {
      const pool = new Pool(configuration),
        connect = pool.connect.bind(pool),
        wrapped = new WeakSet();
      pool.connect = async () => {
        const connection = await connect();
        if (!wrapped.has(connection)) {
          const query = connection.query.bind(connection);
          connection.query = async (...args) => {
            try {
              return await query(...args);
            } catch (error) {
              console.error(
                JSON.stringify({
                  stage: "query",
                  code: error.code,
                  constraint: error.constraint ?? null,
                  routine: error.routine ?? null,
                  message: error.message,
                }),
              );
              throw error;
            }
          };
          wrapped.add(connection);
        }
        return connection;
      };
      return pool;
    });
  const first = makePersistence(),
    second = makePersistence();
  try {
    if (args.includes("--write-catalog")) {
      const catalog = await captureDatabaseCatalog({
        query: async (text, values = []) => ({
          rows: (await client.query(text, [...values])).rows,
        }),
      });
      await writeFile(
        path.join(workspaceRoot, "database/schema/expected-catalog.json"),
        `${JSON.stringify(catalog, null, 2)}\n`,
      );
    }
    check(
      JSON.stringify(await capture()) ===
        JSON.stringify(
          JSON.parse(
            await readFile(
              path.join(workspaceRoot, "database/schema/expected-catalog.json"),
              "utf8",
            ),
          ),
        ),
      "current schema matches reviewed catalog",
    );
    stage = "transaction-manager";
    check(
      typeof first.adminPaymentConfigurationTransactionManager
        ?.runInAdminPaymentConfigurationTransaction === "function",
      "configuration transaction manager exists",
    );
    const actors = [];
    for (let i = 0; i < 3; i++) {
      const id = randomUUID(),
        role = randomUUID(),
        token = randomBytes(32).toString("hex"),
        csrf = randomBytes(32).toString("hex");
      await client.query(
        `INSERT INTO admin_identities(id,issuer,external_subject_hash,status) VALUES($1,'https://configuration-identity.example.test',$2,'ACTIVE')`,
        [id, randomBytes(32)],
      );
      await client.query(
        `INSERT INTO roles(id,role_key,description) VALUES($1,$2,'TEST payment configuration role')`,
        [role, `config:${randomUUID()}`],
      );
      await client.query(
        `INSERT INTO admin_identity_roles(admin_identity_id,role_id) VALUES($1,$2)`,
        [id, role],
      );
      await client.query(
        `INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE permission_key=ANY($2::text[])`,
        [
          role,
          i === 0
            ? ["payments.read", "payments.configure", "payments.publish"]
            : i === 1
              ? ["payments.review"]
              : ["payments.read"],
        ],
      );
      for (const locale of SUPPORTED_LOCALES) {
        const audit = randomUUID();
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category) VALUES($1,'ADMIN',$2,'CONTENT_LOCALE_GRANT','ADMIN_CONTENT_LOCALE_GRANT',$2,'LOCAL_ACCEPTANCE',$3,$3,'SUCCEEDED','CONTENT_TRANSLATION')`,
          [audit, id, randomUUID()],
        );
        await client.query(
          `INSERT INTO admin_content_locale_grants(id,admin_identity_id,locale,granted_by,audit_log_id) VALUES($1,$2,$3,$2,$4)`,
          [randomUUID(), id, locale, audit],
        );
        await client.query("COMMIT");
      }
      const session = randomUUID();
      await client.query(
        `INSERT INTO admin_sessions(id,admin_identity_id,session_token_digest,csrf_token_digest,authenticated_with_mfa,expires_at) VALUES($1,$2,decode($3,'hex'),decode($4,'hex'),true,clock_timestamp()+interval '1 hour')`,
        [session, id, token, csrf],
      );
      actors.push({
        id,
        session,
        access: {
          schemaVersion: 1,
          sessionTokenDigest: token,
          csrfTokenDigest: csrf,
          requestId: randomUUID(),
          correlationId: randomUUID(),
        },
      });
    }
    const merchant = randomUUID(),
      account = randomUUID();
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO merchant_entities(id,entity_key,legal_country,status) VALUES($1,$2,'US','ACTIVE')`,
      [merchant, `test-${randomUUID()}`],
    );
    await client.query(
      `INSERT INTO payment_provider_accounts(id,merchant_entity_id,adapter_key,environment,account_reference_digest,credential_secret_ref,status) VALUES($1,$2,'fake','TEST',$3,$4,'ACTIVE')`,
      [
        account,
        merchant,
        randomBytes(32),
        `secret-ref:v1:aws-sm:test/payment/${account}`,
      ],
    );
    await client.query(
      `INSERT INTO payment_provider_health_events(id,provider_account_id,sequence,from_status,to_status,observer_kind,task_name,reason_code,request_id,correlation_id) VALUES($1,$2,1,NULL,'HEALTHY','SYSTEM','configuration-storage-test','SYNTHETIC_TEST_HEALTH',$3,$4)`,
      [randomUUID(), account, randomUUID(), randomUUID()],
    );
    await client.query("COMMIT");
    const deployed = [
      {
        providerAccountId: account,
        environment: "TEST",
        adapterKey: "fake",
        adapterVersion: "1.0.0",
        paymentMethods: ["fake_card"],
      },
    ];
    const request = (command, actor = 0) => ({
      schemaVersion: 1,
      access: {
        ...actors[actor].access,
        requestId: randomUUID(),
        correlationId: randomUUID(),
      },
      command: { schemaVersion: 1, ...command },
      requestHash:
        "idempotencyKey" in command
          ? createHash("sha256").update(JSON.stringify(command)).digest("hex")
          : null,
      deployedAccounts: deployed,
    });
    const execute = (command, actor = 0, instance = first) =>
      instance.adminPaymentConfigurationTransactionManager.runInAdminPaymentConfigurationTransaction(
        (r) => r.execute(request(command, actor)),
      );
    const success = (r, label) => {
      check(r.outcome === "SUCCESS", `${label}: ${r.code ?? r.kind}`);
      return r;
    };
    const failure = (r, code) =>
      check(r.outcome === "FAILURE" && r.code === code, `fails ${code}`);
    const configuration = {
      schemaVersion: 1,
      channels: [
        {
          providerAccountId: account,
          enabled: true,
          displayOrder: 0,
          rolloutBasisPoints: 10000,
          healthPolicy: {
            failureThreshold: 3,
            failureWindowMs: 60000,
            openDurationMs: 1000,
            probeLeaseMs: 1000,
            probeRetryMs: 1000,
          },
          translations: SUPPORTED_LOCALES.map((locale) => ({
            locale,
            displayName: `TEST ${locale}`,
            customerHint: `TEST payment hint ${locale}`,
            translatedFromSourceHash: null,
          })),
        },
      ],
      routes: [
        {
          ruleKey: "test.card",
          providerAccountId: account,
          paymentMethod: "fake_card",
          enabled: true,
          countries: ["US"],
          markets: ["GLOBAL"],
          currencies: ["USD"],
          minimumAmountMinor: 0,
          maximumAmountMinor: 100000,
          requiredDeviceCapabilities: ["REDIRECT"],
          priority: 0,
          rolloutBasisPoints: 10000,
        },
      ],
    };
    stage = "document-guard";
    await verifyPaymentConfigurationDocument({ client, check, configuration });
    stage = "draft-and-approval";
    const saveCommand = {
      action: "SAVE",
      sourceRevisionId: null,
      expectedPublicationId: null,
      idempotencyKey: randomUUID(),
      configuration,
    };
    failure(await execute(saveCommand, 2), "FORBIDDEN");
    const saved = success(await execute(saveCommand), "save");
    const replay = success(
      await execute(saveCommand, 0, second),
      "permanent replay",
    );
    check(
      replay.replayed && replay.revisionId === saved.revisionId,
      "same key uses immutable receipt",
    );
    failure(
      await execute({
        ...saveCommand,
        configuration: { ...configuration, routes: [] },
      }),
      "IDEMPOTENCY_CONFLICT",
    );
    const workspace = success(
      await execute({ action: "READ", revisionId: saved.revisionId }),
      "workspace",
    );
    check(
      workspace.selected.reviews.every((r) => r.status === "DRAFT"),
      "all languages start unapproved",
    );
    const invalid = success(
      await execute({
        action: "VALIDATE",
        revisionId: saved.revisionId,
        mode: "PUBLISH",
        expectedPublicationId: null,
      }),
      "invalid validation",
    );
    check(
      !invalid.valid && invalid.validationHash === null,
      "unapproved translations cannot publish",
    );
    for (const locale of SUPPORTED_LOCALES) {
      success(
        await execute({
          action: "SUBMIT",
          revisionId: saved.revisionId,
          providerAccountId: account,
          locale,
          idempotencyKey: randomUUID(),
        }),
        "submit",
      );
      success(
        await execute(
          {
            action: "APPROVE",
            revisionId: saved.revisionId,
            providerAccountId: account,
            locale,
            idempotencyKey: randomUUID(),
          },
          1,
        ),
        "independent approve",
      );
    }
    stage = "publication";
    const validation = success(
      await execute({
        action: "VALIDATE",
        revisionId: saved.revisionId,
        mode: "PUBLISH",
        expectedPublicationId: null,
      }),
      "valid",
    );
    check(validation.valid, "all approved valid");
    const publish = {
      action: "PUBLISH",
      revisionId: saved.revisionId,
      expectedPublicationId: null,
      validationHash: validation.validationHash,
      reasonCode: "LOCAL_VERIFIED",
      confirmed: true,
      idempotencyKey: randomUUID(),
    };
    const published = success(await execute(publish), "publish");
    check(published.generation === 1, "first publication generation");
    const projection =
      await second.adminPaymentConfigurationTransactionManager.runInAdminPaymentConfigurationTransaction(
        (r) => r.readPublished(),
      );
    check(
      projection?.publicationId === published.publicationId &&
        projection.policies[0].version === 1,
      "second instance reads exact activated policy",
    );
    success(await execute(publish), "publish replay");
    stage = "approval-copy";
    await verifyPaymentConfigurationCopies({
      client,
      check,
      execute,
      configuration,
      actors,
      deployed,
      first,
      second,
      request,
      published,
      saved,
      success,
      failure,
    });
    stage = "managed-account-capacity";
    await verifyPaymentConfigurationUuid({
      execute,
      published,
      success,
      check,
    });
    await verifyPaymentConfigurationCapacity({
      client,
      check,
      execute,
      deployed,
      published,
      configuration,
      failure,
    });
    stage = "storage-boundaries";
    await verifyPaymentConfigurationStorage({
      client,
      check,
      execute,
      configuration,
      actors,
      deployed,
      first,
      second,
      request,
      published,
      saved,
      success,
      failure,
    });
    stage = "finished";
    console.log(JSON.stringify({ passed: true, checks, stage }));
  } catch (error) {
    console.error(
      JSON.stringify({
        passed: false,
        stage,
        code: error?.code ?? null,
        message: error?.message?.slice(0, 180) ?? null,
      }),
    );
    throw error;
  } finally {
    await Promise.all([first.close(), second.close()]);
    await client.end();
  }
});
