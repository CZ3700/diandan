import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomUUID, createHash } from "node:crypto";
import { Client } from "pg";
import { runMigrations } from "@fan-support/persistence-postgres";
import {
  SUPPORTED_LOCALES,
  adminSessionPermissionSchema,
  adminOrdersPermissionSchema,
  giftCommercePermissionSchema,
} from "@fan-support/contracts";
import { digestAdminIdentitySubject } from "@fan-support/application";
import { seedPaymentRuntimeConfiguration } from "./payment-runtime-config-fixture.mjs";
import { writePrivateJson } from "../../../scripts/local-experience-state.mjs";
import path from "node:path";
import { prepareOrderPaymentQueue } from "./order-payment-queue.mjs";
import { parseLocalBusiness } from "./local-experience-bootstrap-state.mjs";

export async function bootstrapLocalBusiness({
  workspaceRoot,
  database,
  config,
  stateDirectory,
}) {
  await runMigrations({
    clientConfig: database,
    workspaceRoot,
    command: { direction: "up" },
  });
  await prepareOrderPaymentQueue(database);
  const client = new Client(database);
  await client.connect();
  try {
    await client.query(
      "SELECT pg_advisory_lock(hashtextextended('local-experience-bootstrap',0))",
    );
    await client.query("CREATE SCHEMA IF NOT EXISTS local_experience");
    await client.query(
      "CREATE TABLE IF NOT EXISTS local_experience.bootstrap (id integer PRIMARY KEY CHECK(id=1),instance_id uuid NOT NULL,state jsonb NOT NULL)",
    );
    const existing = (
      await client.query(
        "SELECT instance_id,state FROM local_experience.bootstrap WHERE id=1",
      )
    ).rows[0];
    if (existing) {
      if (existing.instance_id !== config.instanceId)
        throw new Error("Business database ownership mismatch");
      parseLocalBusiness(existing.state, config);
      return await finishPaymentBootstrap({ client, config, stateDirectory });
    }
    const actors = config.services.oidc.actors,
      manager = actors.find((v) => v.key === "manager").id;
    await client.query("BEGIN");
    try {
      for (const actor of actors)
        await client.query(
          "INSERT INTO admin_identities(id,issuer,external_subject_hash,status,mfa_required) VALUES($1,$2,$3,'ACTIVE',true)",
          [
            actor.id,
            config.origins.oidc,
            Buffer.from(
              digestAdminIdentitySubject({
                issuer: config.origins.oidc,
                subject: actor.subject,
                subjectPepper: Buffer.from(
                  config.secrets.subjectPepper,
                  "base64url",
                ).toString("hex"),
              }),
              "hex",
            ),
          ],
        );
      const permissions = [
        ...new Set([
          ...adminSessionPermissionSchema.options,
          ...adminOrdersPermissionSchema.options,
          ...giftCommercePermissionSchema.options,
          "management.direct",
          "finance.manage",
          "payments.read",
          "payments.configure",
          "payments.review",
          "payments.publish",
          "exceptions.read",
          "exceptions.replay",
        ]),
      ];
      for (const key of permissions)
        await client.query(
          "INSERT INTO permissions(id,permission_key,description) VALUES($1,$2,'Local TEST operator permission') ON CONFLICT(permission_key) DO NOTHING",
          [randomUUID(), key],
        );
      for (const actor of actors) {
        const role = randomUUID();
        await client.query(
          "INSERT INTO roles(id,role_key,description) VALUES($1,$2,'Local TEST role')",
          [role, "local:" + actor.key + ":" + config.instanceId],
        );
        await client.query(
          "INSERT INTO admin_identity_roles(admin_identity_id,role_id,granted_by) VALUES($1,$2,$3)",
          [actor.id, role, manager],
        );
        const grants =
          actor.key === "manager"
            ? permissions
            : permissions.filter(
                (key) => key.includes("review") || key.endsWith(".read"),
              );
        for (const key of grants)
          await client.query(
            "INSERT INTO role_permissions(role_id,permission_id,granted_by) SELECT $1,id,$2 FROM permissions WHERE permission_key=$3",
            [role, manager, key],
          );
        for (const locale of SUPPORTED_LOCALES)
          for (const kind of ["content", "message"]) {
            const audit = randomUUID(),
              request = randomUUID();
            const isContent = kind === "content";
            await client.query(
              "INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category) VALUES($1,'ADMIN',$2,$3,$4,$5,'LOCAL_TEST_BOOTSTRAP',$6,$6,'SUCCEEDED',$7)",
              [
                audit,
                manager,
                isContent
                  ? "CONTENT_LOCALE_GRANT"
                  : "ORDER_MESSAGE_LOCALE_GRANT",
                isContent
                  ? "ADMIN_CONTENT_LOCALE_GRANT"
                  : "ADMIN_ORDER_MESSAGE_LOCALE_GRANT",
                actor.id,
                request,
                isContent ? "CONTENT_TRANSLATION" : "SUPPORT_INTENT_PRIVATE",
              ],
            );
            await client.query(
              `INSERT INTO ${isContent ? "admin_content_locale_grants" : "admin_order_message_locale_grants"}(admin_identity_id,locale,granted_by,audit_log_id) VALUES($1,$2,$3,$4)`,
              [actor.id, locale, manager, audit],
            );
          }
      }
      await client.query(
        "INSERT INTO markets(id,market,default_currency,status) VALUES($1,'GLOBAL','USD','ACTIVE')",
        [randomUUID()],
      );
      const defaults = randomUUID();
      await client.query(
        "INSERT INTO config_versions(id,config_kind,version,lifecycle,created_by) VALUES($1,'MANAGEMENT_DEFAULTS',1,'DRAFT',$2)",
        [defaults, manager],
      );
      await client.query(
        "INSERT INTO management_defaults(config_version_id,market,currency,inventory_policy,inventory_location_id,eligibility_rule,artist_presentation) VALUES($1,'GLOBAL','USD','PROCURE_ON_DEMAND',NULL,'ALL_ACTIVE_ARTISTS',$2)",
        [defaults, { themeAccent: "#CCAE7F", heroTextTone: "light" }],
      );
      await client.query(
        "UPDATE config_versions SET lifecycle='VALIDATED' WHERE id=$1",
        [defaults],
      );
      await client.query(
        "UPDATE config_versions SET lifecycle='PUBLISHED',published_at=clock_timestamp() WHERE id=$1",
        [defaults],
      );
      const initial = {
        schemaVersion: 1,
        testOnly: true,
        managerId: manager,
        stage: "IDENTITIES_READY",
        paymentConfiguration: {
          schemaVersion: 1,
          publicStorefrontOrigin: config.origins.storefront,
          leaseMs: 30000,
          recoveryDelayMs: 10000,
          actionTtlMs: 300000,
          returnStateTtlMs: 3600000,
          recoveryBatchSize: 10,
        },
      };
      await client.query(
        "INSERT INTO local_experience.bootstrap(id,instance_id,state) VALUES(1,$1,$2)",
        [config.instanceId, initial],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    return await finishPaymentBootstrap({ client, config, stateDirectory });
  } finally {
    await client.end();
  }
}
async function finishPaymentBootstrap({ client, config, stateDirectory }) {
  const business = parseLocalBusiness(
    (
      await client.query(
        "SELECT state FROM local_experience.bootstrap WHERE id=1",
      )
    ).rows[0].state,
    config,
  );
  if (business.stage === "IDENTITIES_READY") {
    const head = (
      await client.query(
        "SELECT publication_id,config_version_id,config_version FROM payment_config_publication_heads",
      )
    ).rows;
    let published;
    if (head.length === 0)
      published = await seedPaymentRuntimeConfiguration({
        client,
        identity: {
          identities: { identities: { manager: business.managerId } },
        },
        bindings: [config.services.psp.binding],
        configuration: business.paymentConfiguration,
        scope: { country: "US", market: "GLOBAL", currency: "USD" },
        check: assert.ok,
      });
    else {
      const accounts = (
        await client.query(
          "SELECT a.id,a.environment,a.adapter_key FROM payment_provider_configs p JOIN payment_provider_accounts a ON a.id=p.provider_account_id WHERE p.config_version_id=$1",
          [head[0].config_version_id],
        )
      ).rows;
      if (
        head.length !== 1 ||
        accounts.length !== 1 ||
        accounts[0].id !== config.services.psp.binding.providerAccountId ||
        accounts[0].environment !== "TEST" ||
        accounts[0].adapter_key !== "fake"
      )
        throw new Error(
          "Existing payment configuration was preserved; bootstrap identity differs",
        );
      published = {
        schemaVersion: 1,
        testOnly: true,
        syntheticReviewOnly: true,
        recoveredFromPostgres: true,
        configVersionId: head[0].config_version_id,
        configVersion: Number(head[0].config_version),
        publicationId: head[0].publication_id,
      };
    }
    const endpointId = config.services.psp.webhookEndpointId,
      providerAccountId = config.services.psp.binding.providerAccountId,
      secretRef = "secret-ref:v1:test:local/webhook/" + endpointId,
      audit = randomUUID();
    const verificationKeyReferenceHash = createHash("sha256")
      .update(secretRef)
      .digest("hex");
    await client.query("BEGIN");
    try {
      const prior = (
        await client.query(
          "SELECT provider_account_id,environment,verification_key_reference_hash,status FROM payment_webhook_endpoints WHERE id=$1",
          [endpointId],
        )
      ).rows[0];
      if (prior) {
        if (
          prior.provider_account_id !== providerAccountId ||
          prior.environment !== "TEST" ||
          prior.verification_key_reference_hash !==
            verificationKeyReferenceHash ||
          prior.status !== "ACTIVE"
        )
          throw new Error(
            "Existing webhook endpoint was preserved; bootstrap identity differs",
          );
      } else {
        await client.query(
          "INSERT INTO audit_logs(id,actor_type,task_name,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome) VALUES($1,'SYSTEM','local-experience-bootstrap','PAYMENT_WEBHOOK_ENDPOINT_ACTIVATED','PAYMENT_WEBHOOK_ENDPOINT',$2,'INITIAL_ENDPOINT',$3,$4,'SUCCEEDED')",
          [audit, endpointId, randomUUID(), randomUUID()],
        );
        await client.query(
          "INSERT INTO payment_webhook_endpoints(id,provider_account_id,environment,verification_secret_ref,verification_key_reference_hash,status,active_from,lifecycle_audit_log_id) VALUES($1,$2,'TEST',$3,$4,'ACTIVE',transaction_timestamp(),$5)",
          [
            endpointId,
            providerAccountId,
            secretRef,
            verificationKeyReferenceHash,
            audit,
          ],
        );
      }
      Object.assign(business, {
        endpoint: {
          endpointId,
          providerAccountId,
          verificationKeyReferenceHash,
        },
        published,
        stage: "PAYMENTS_READY",
      });
      await client.query(
        "UPDATE local_experience.bootstrap SET state=$1 WHERE id=1",
        [business],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
  parseLocalBusiness(business, config);
  await writePrivateJson(path.join(stateDirectory, "business.json"), business);
  return business;
}
export { bootstrapLocalPolicies } from "./local-experience-bootstrap-policies.mjs";
