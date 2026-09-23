import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { Client } from "pg";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { digestAdminContentToken } from "@fan-support/application";
import { createStorefrontContentClient } from "./storefront-content-client.mjs";
import { workspaceTranslations } from "./admin-workspace-fixtures.mjs";
import { giftStorefrontCopy } from "./gift-storefront-copy.mjs";
import { writePrivateJson } from "../../../scripts/local-experience-state.mjs";
import {
  parseLocalBusiness,
  matchingLocalPolicy,
} from "./local-experience-bootstrap-state.mjs";

/** Only initial TEST policies use short-lived synthetic independent staff sessions; daily access uses OIDC. */
export async function bootstrapLocalPolicies({
  database,
  config,
  business,
  base,
  stateDirectory,
  progress,
}) {
  const client = new Client(database);
  await client.connect();
  const credentials = {},
    sessionIds = [],
    pepper = Buffer.from(config.secrets.tokenPepper, "base64url").toString(
      "hex",
    );
  try {
    await client.query(
      "SELECT pg_advisory_lock(hashtextextended('local-experience-bootstrap',0))",
    );
    business = parseLocalBusiness(
      (
        await client.query(
          "SELECT state FROM local_experience.bootstrap WHERE id=1",
        )
      ).rows[0].state,
      config,
    );
    if (business.stage === "READY") return business;
    if (business.stage !== "PAYMENTS_READY")
      throw new Error("Payment bootstrap must finish before policies");
    const save = async () => {
      parseLocalBusiness(business, config);
      await client.query(
        "UPDATE local_experience.bootstrap SET state=$1 WHERE id=1",
        [business],
      );
    };
    for (const actor of config.services.oidc.actors) {
      const value = {
          token: randomBytes(32).toString("base64url"),
          csrf: randomBytes(32).toString("base64url"),
        },
        id = randomUUID();
      credentials[actor.key] = value;
      sessionIds.push(id);
      await client.query(
        "INSERT INTO admin_sessions(id,admin_identity_id,session_token_digest,csrf_token_digest,authenticated_with_mfa,expires_at) VALUES($1,$2,$3,$4,true,clock_timestamp()+interval '30 minutes')",
        [
          id,
          actor.id,
          Buffer.from(
            digestAdminContentToken({
              tokenPepper: pepper,
              purpose: "admin-session",
              token: value.token,
            }),
            "hex",
          ),
          Buffer.from(
            digestAdminContentToken({
              tokenPepper: pepper,
              purpose: "admin-csrf",
              token: value.csrf,
            }),
            "hex",
          ),
        ],
      );
    }
    credentials.editor = credentials.manager;
    const content = createStorefrontContentClient({
      base,
      origin: config.origins.admin,
      credentials,
      check: assert.ok,
    });
    for (const [index, kind] of [
      "TERMS",
      "PRIVACY",
      "REFUND",
      "DELIVERY",
    ].entries()) {
      const policyKey = kind.toLowerCase(),
        owner = { kind: "POLICY", policyKey };
      if (
        (
          await client.query(
            "SELECT 1 FROM policy_publication_heads WHERE policy_key=$1",
            [policyKey],
          )
        ).rowCount
      )
        continue;
      progress("publish local TEST policy " + kind);
      business.policyPlans ??= {};
      if (!business.policyPlans[policyKey]) {
        business.policyPlans[policyKey] = {
          content: {
            kind: "POLICY",
            structure: {
              kind,
              effectiveAt: new Date(Date.now() + 3000).toISOString(),
            },
            translations: workspaceTranslations((locale) => ({
              title: "TEST · " + giftStorefrontCopy[locale].policyTitles[index],
              summary: "Local TEST · " + giftStorefrontCopy[locale].subtitle,
              body:
                "<p>Local TEST · " + giftStorefrontCopy[locale].care + "</p>",
            })),
          },
        };
        await save();
      }
      const plan = business.policyPlans[policyKey];
      const registered = (
        await client.query("SELECT kind FROM policies WHERE policy_key=$1", [
          policyKey,
        ])
      ).rows[0];
      if (registered && registered.kind !== kind)
        throw new Error("Existing policy was preserved; its kind differs");
      if (!registered)
        await content.write("/api/v1/admin/resources/policies/register", {
          policyKey,
          kind,
          expectedVersion: 0,
        });
      let revisionId = plan.revisionId;
      if (!revisionId) {
        const existing = (
          await client.query(
            "SELECT id FROM policy_revisions WHERE policy_key=$1 ORDER BY revision",
            [policyKey],
          )
        ).rows;
        for (const row of existing) {
          const read = await content.request(
            "/api/v1/admin/content-authoring/read",
            { target: owner, revisionId: row.id },
          );
          if (matchingLocalPolicy(read.snapshot.content, plan.content)) {
            revisionId = row.id;
            break;
          }
        }
        if (existing.length && !revisionId)
          throw new Error(
            "Existing policy draft was preserved; it is not this bootstrap content",
          );
        revisionId ??= await content.author(owner, plan.content);
        plan.revisionId = revisionId;
        await save();
      }
      const snapshot = (
        await content.request("/api/v1/admin/content-authoring/read", {
          target: owner,
          revisionId,
        })
      ).snapshot;
      if (!matchingLocalPolicy(snapshot.content, plan.content))
        throw new Error(
          "Bootstrap policy content changed; existing revision was preserved",
        );
      for (const locale of SUPPORTED_LOCALES) {
        const target = { owner, revisionId, locale };
        let read = await content.request("/api/v1/admin/content-review/read", {
          target,
        });
        if (read.context.audit.review.status === "DRAFT") {
          await content.write(
            "/api/v1/admin/content-review/submit",
            {
              target,
              expectedVersion: read.context.audit.reviewSequence,
              expectedContentHash: read.context.audit.sourceHash,
              expectedSourceHash: read.context.currentEnglishSourceHash,
            },
            "manager",
          );
          read = await content.request("/api/v1/admin/content-review/read", {
            target,
          });
        }
        if (read.context.audit.review.status === "IN_REVIEW")
          await content.write(
            "/api/v1/admin/content-review/approve",
            {
              target,
              expectedVersion: read.context.audit.reviewSequence,
              expectedContentHash: read.context.audit.sourceHash,
              expectedSourceHash: read.context.currentEnglishSourceHash,
            },
            "reviewer",
          );
        else if (read.context.audit.review.status !== "APPROVED")
          throw new Error(
            "Existing policy review state requires explicit review",
          );
      }
      while (Date.now() < Date.parse(plan.content.structure.effectiveAt) + 1000)
        await delay(100);
      const target = { owner, revisionId };
      const preflight = await content.request(
        "/api/v1/admin/content/publication/preflight",
        { target, action: "PUBLISH" },
        { actor: "manager" },
      );
      assert.ok(
        preflight.ready,
        "local TEST policy must satisfy the existing full publication gate",
      );
      const validated =
        snapshot.lifecycle.status === "DRAFT"
          ? await content.write(
              "/api/v1/admin/content/publication/validate",
              {
                target,
                expectedVersion: preflight.headVersion,
                expectedContentHash: preflight.contentHash,
              },
              "manager",
            )
          : preflight;
      await content.write(
        "/api/v1/admin/content/publication/publish",
        {
          target,
          expectedVersion: validated.headVersion,
          expectedContentHash: validated.contentHash,
        },
        "manager",
      );
    }
    business.stage = "READY";
    await save();
    await writePrivateJson(
      path.join(stateDirectory, "business.json"),
      business,
    );
    return business;
  } finally {
    if (sessionIds.length)
      await client.query(
        "UPDATE admin_sessions SET revoked_at=clock_timestamp() WHERE id=ANY($1::uuid[]) AND revoked_at IS NULL",
        [sessionIds],
      );
    await client.end();
  }
}
