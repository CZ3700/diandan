import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { Client } from "pg";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { withEphemeralPostgres } from "../dist/testing/ephemeral-postgres.js";

const original = await readFile(
  new URL(
    "../../../database/migrations/0006_publication-heads-outbox.up.sql",
    import.meta.url,
  ),
  "utf8",
);
const current = await readFile(
  new URL(
    "../../../database/migrations/0022_daily-management-publication.up.sql",
    import.meta.url,
  ),
  "utf8",
);
const pattern =
  /CREATE(?: OR REPLACE)? FUNCTION public\.assert_publication_outbox_source\(\)[\s\S]+?\n\$\$;/gu;
const definition =
  [...current.matchAll(pattern)].at(-1)?.[0] ??
  [...original.matchAll(pattern)][0]?.[0];
assert.ok(definition);
const id = Object.fromEntries(
  [
    "actor",
    "session",
    "operation",
    "publication",
    "revision",
    "owner",
    "audit",
    "request",
    "source",
  ].map((key) => [key, randomUUID()]),
);
const locales = SUPPORTED_LOCALES;
const time = "2026-09-08T00:00:00.000000Z";
const document = {
  schemaVersion: 3,
  kind: "IDOL",
  ownerId: id.owner,
  revisionId: id.revision,
  source: {
    id: id.source,
    locale: "zh-CN",
    fields: { displayName: "真实原文" },
  },
};
const manifest = {
  schemaVersion: 3,
  publicationMode: "DIRECT_OPERATOR_V1",
  operationId: id.operation,
  actorId: id.actor,
  document,
};
let assertions = 0;
await withEphemeralPostgres(async (config) => {
  const client = new Client(config);
  await client.connect();
  try {
    // Deliberately isolate the real outbox relationship trigger. Full publication,
    // rights, authorization and immutable-history guards are tested by the real runtime.
    await client.query(`CREATE TABLE public.audit_logs(id uuid,request_id uuid,correlation_id uuid);
   CREATE TABLE public.content_publications(id uuid,content_type text,proof_version int,idol_id uuid,gift_id uuid,media_asset_id uuid,idol_revision_id uuid,gift_revision_id uuid,homepage_revision_id uuid,policy_revision_id uuid,media_metadata_revision_id uuid,site_locale_config_revision_id uuid,audit_log_id uuid,published_by uuid,published_at timestamptz);
   CREATE TABLE public.daily_publication_revisions(revision_id uuid,object_kind text,object_id uuid,operation_id uuid,actor_id uuid,source_locale text,source_translation_id uuid,document jsonb);
   CREATE TABLE public.daily_publication_manifests(publication_id uuid,revision_id uuid,operation_id uuid,actor_id uuid,session_id uuid,audit_log_id uuid,published_at timestamptz,manifest jsonb);
   CREATE TABLE public.management_operations(id uuid,actor_id uuid,session_id uuid,capability text);
   CREATE TABLE public.config_versions(id uuid,version int);
   CREATE TABLE public.payment_config_publications(id uuid,config_version_id uuid,audit_log_id uuid,created_at timestamptz);
   CREATE TABLE public.price_book_publications(id uuid,price_book_id uuid,price_book_revision int,audit_log_id uuid,market text,currency text,published_at timestamptz);
   CREATE TABLE public.outbox_events(event_type text,aggregate_type text,aggregate_id uuid,aggregate_version int,primary_subject_id uuid,secondary_subject_id uuid,locale text,market text,currency text,idempotency_key text,request_id uuid,correlation_id uuid,occurred_at timestamptz);`);
    for (const kind of ["idol", "gift", "homepage", "policy", "media_metadata"])
      await client.query(
        `CREATE TABLE public.${kind}_revision_translations(${kind}_revision_id uuid,locale text)`,
      );
    await client.query(
      "CREATE TABLE public.site_locale_config_entries(site_locale_config_revision_id uuid,locale text,enabled boolean)",
    );
    await client.query(definition);
    await client.query(
      "CREATE CONSTRAINT TRIGGER source_check AFTER INSERT ON public.outbox_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assert_publication_outbox_source()",
    );
    await client.query("INSERT INTO public.audit_logs VALUES($1,$2,$2)", [
      id.audit,
      id.request,
    ]);
    await client.query(
      "INSERT INTO public.content_publications(id,content_type,proof_version,idol_id,idol_revision_id,audit_log_id,published_by,published_at) VALUES($1,'IDOL',3,$2,$3,$4,$5,$6)",
      [id.publication, id.owner, id.revision, id.audit, id.actor, time],
    );
    await client.query(
      "INSERT INTO public.management_operations VALUES($1,$2,$3,'DIRECT_OPERATOR_V1')",
      [id.operation, id.actor, id.session],
    );
    await client.query(
      "INSERT INTO public.daily_publication_revisions VALUES($1,'IDOL',$2,$3,$4,'zh-CN',$5,$6)",
      [id.revision, id.owner, id.operation, id.actor, id.source, document],
    );
    await client.query(
      "INSERT INTO public.daily_publication_manifests VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        id.publication,
        id.revision,
        id.operation,
        id.actor,
        id.session,
        id.audit,
        time,
        manifest,
      ],
    );
    const event = (locale) => ({
      event_type: "CONTENT_PUBLICATION_CHANGED",
      aggregate_type: "CONTENT_PUBLICATION",
      aggregate_id: id.publication,
      aggregate_version: 1,
      primary_subject_id: id.publication,
      secondary_subject_id: id.revision,
      locale,
      market: null,
      currency: null,
      idempotency_key: `content-publication:${id.publication}:${locale}`,
      request_id: id.request,
      correlation_id: id.request,
      occurred_at: time,
    });
    async function commitEvents(events, shouldPass, label) {
      await client.query("BEGIN");
      let actual;
      try {
        for (const value of events) {
          const columns = Object.keys(value);
          await client.query(
            `INSERT INTO public.outbox_events(${columns.join(",")}) VALUES(${columns.map((_, index) => `$${index + 1}`).join(",")})`,
            Object.values(value),
          );
        }
        await client.query("COMMIT");
        actual = "COMMIT";
      } catch (error) {
        await client.query("ROLLBACK");
        actual = error.code;
      }
      assert.equal(actual, shouldPass ? "COMMIT" : "23514", label);
      assertions++;
    }
    await commitEvents(
      locales.map(event),
      true,
      "seven invalidation routes must bind one real original without fake translations",
    );
    for (const [key, value] of [
      ["aggregate_version", 2],
      ["secondary_subject_id", id.owner],
      ["idempotency_key", "wrong"],
      ["request_id", id.actor],
      ["correlation_id", id.actor],
      ["occurred_at", "2026-09-09T00:00:00Z"],
      ["market", "TEST"],
      ["currency", "USD"],
      ["locale", null],
    ])
      await commitEvents(
        [{ ...event("en"), [key]: value }],
        false,
        `existing ${key} binding remains exact`,
      );
    for (const [column, value] of [
      ["actor_id", id.owner],
      ["session_id", id.owner],
      ["audit_log_id", id.owner],
      ["revision_id", id.owner],
      ["operation_id", id.owner],
    ]) {
      await client.query(
        `UPDATE public.daily_publication_manifests SET ${column}=$1`,
        [value],
      );
      await commitEvents(
        [event("en")],
        false,
        `daily manifest ${column} cannot cross its real source`,
      );
      const restore = {
        actor_id: id.actor,
        session_id: id.session,
        audit_log_id: id.audit,
        revision_id: id.revision,
        operation_id: id.operation,
      };
      await client.query(
        `UPDATE public.daily_publication_manifests SET ${column}=$1`,
        [restore[column]],
      );
    }
    await client.query(
      "UPDATE public.content_publications SET proof_version=2",
    );
    await commitEvents(
      [event("en")],
      false,
      "legacy still requires its actual locale translation",
    );
    await client.query(
      "INSERT INTO public.idol_revision_translations VALUES($1,'en')",
      [id.revision],
    );
    await commitEvents(
      [event("en")],
      true,
      "legacy exact source remains accepted",
    );
    process.stdout.write(
      JSON.stringify({
        schemaVersion: 1,
        result: "PASS",
        assertions,
        scope: "real PostgreSQL, actual isolated outbox relationship trigger",
      }) + "\n",
    );
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        schemaVersion: 1,
        result: "FAIL",
        assertions,
        assertion:
          error instanceof assert.AssertionError
            ? error.message
            : "isolated outbox probe failed",
      }) + "\n",
    );
    throw error;
  } finally {
    await client.end();
  }
});
