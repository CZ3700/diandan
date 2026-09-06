import { randomUUID } from "node:crypto";
import { readAdminCatalog } from "../dist/admin-catalog-read.js";

/** A matching final row is insufficient: an identity receipt must attest an actual old-to-new transition. */
export async function verifyAdminCatalogTransitionProof({
  client,
  fixtures,
  check,
}) {
  let failure;
  await client.query("BEGIN");
  try {
    const id = fixtures.targets.idol.idolId,
      auditId = randomUUID(),
      requestId = randomUUID(),
      redirectId = randomUUID();
    await client.query(
      "INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category,created_at) SELECT $1,'ADMIN',$2,'RENAME_IDOL','IDOL_IDENTITY',id,'FORGED_TRANSITION_FIXTURE',$3,$3,'SUCCEEDED','CONTENT_IDENTITY',updated_at FROM idols WHERE id=$4",
      [auditId, fixtures.editor, requestId, id],
    );
    await client.query(
      "INSERT INTO slug_redirects(id,entity_type,idol_id,old_handle,new_handle,created_at) SELECT $1,'IDOL',id,'never-was-this-name',handle,updated_at FROM idols WHERE id=$2",
      [redirectId, id],
    );
    await client.query(
      `INSERT INTO admin_idol_identity_receipts(id,idol_id,action,expected_base_version,result_base_version,authoring_version,publication_head_version,old_handle,new_handle,old_status,new_status,old_accepting_gifts,new_accepting_gifts,previous_updated_at,draft_revision_id,published_revision_id,actor_id,session_id,audit_log_id,redirect_id,created_at)
      SELECT $1,i.id,'RENAME_IDOL',i.version-1,i.version,(SELECT max(revision) FROM idol_revisions WHERE idol_id=i.id),(SELECT version FROM idol_publication_heads WHERE idol_id=i.id),'never-was-this-name',i.handle,i.status,i.status,i.accepting_gifts,i.accepting_gifts,i.created_at,i.draft_revision_id,i.published_revision_id,$2,$3,$4,$5,i.updated_at FROM idols i WHERE i.id=$6`,
      [
        randomUUID(),
        fixtures.editor,
        fixtures.sessions.editor,
        auditId,
        redirectId,
        id,
      ],
    );
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  } catch (error) {
    failure = error.code;
  } finally {
    await client.query("ROLLBACK");
  }
  check(
    failure,
    "23514",
    "receipt cannot fabricate a rename and reserve history without an actual identity transition",
  );
}

export async function verifyUnsealedExportProof({
  client,
  fixtures,
  source,
  check,
}) {
  let failure;
  await client.query("BEGIN");
  try {
    const id = randomUUID(),
      auditId = randomUUID(),
      requestId = randomUUID();
    await client.query(
      "INSERT INTO audit_logs(id,actor_type,actor_id,action,subject_type,subject_id,reason_code,request_id,correlation_id,outcome,field_category) VALUES($1,'ADMIN',$2,'TRANSLATION_EXPORT','TRANSLATION_EXPORT_PACKAGE',$3,'UNSEALED_EXPORT_FIXTURE',$4,$4,'SUCCEEDED','CONTENT_TRANSLATION')",
      [auditId, fixtures.editor, id, requestId],
    );
    await client.query(
      "INSERT INTO translation_export_receipts(id,policy_revision_id,expected_authoring_version,source_snapshot_hash,english_source_hash,locales,actor_id,session_id,audit_log_id,created_at) SELECT $1,t.policy_revision_id,1,$2,t.source_hash,ARRAY['ja']::supported_locale[],$3,$4,$5,transaction_timestamp() FROM policy_revision_translations t WHERE t.policy_revision_id=$6 AND t.locale='en'",
      [
        id,
        "a".repeat(64),
        fixtures.editor,
        fixtures.sessions.editor,
        auditId,
        source.revisionId,
      ],
    );
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  } catch (error) {
    failure = error.code;
  } finally {
    await client.query("ROLLBACK");
  }
  check(
    failure,
    "23514",
    "SQL independently rejects an immutable export receipt for an unsealed legacy draft",
  );
}

/** Isolated SQL query fixture: timestamp ties must not invent ledger versions. Production tables and constraints remain untouched. */
export async function verifyPublicationHistoryOrder({
  client,
  fixtures,
  check,
}) {
  await client.query("BEGIN");
  try {
    const owner = fixtures.targets.idol;
    await client.query(
      "CREATE TEMP TABLE admin_history_ties ON COMMIT DROP AS SELECT * FROM public.content_publications WHERE idol_id=$1",
      [owner.idolId],
    );
    const root = (
      await client.query(
        "SELECT id FROM admin_history_ties WHERE replaces_publication_id IS NULL",
      )
    ).rows[0].id;
    const successor = "00000000-0000-4000-8000-000000000001";
    await client.query(
      "INSERT INTO admin_history_ties SELECT (jsonb_populate_record(NULL::public.content_publications,to_jsonb(p.*)||jsonb_build_object('id',$1::text,'replaces_publication_id',p.id))).* FROM admin_history_ties p WHERE id=$2",
      [successor, root],
    );
    const result = await readAdminCatalog(
      {
        query: (sql, values) =>
          client.query(
            sql.replaceAll(
              "public.content_publications",
              "pg_temp.admin_history_ties",
            ),
            values,
          ),
        release: () => undefined,
      },
      {
        schemaVersion: 1,
        action: "READ_HISTORY",
        target: owner,
        history: "PUBLICATIONS",
        page: 1,
        pageSize: 10,
      },
    );
    check(
      result.outcome,
      "SUCCESS",
      "publication history SQL can read an isolated legacy timestamp-tie fixture",
    );
    check(
      result.items.map((row) => [row.publicationId, row.headVersion]),
      [
        [successor, 2],
        [root, 1],
      ],
      "history derives publication versions from the predecessor chain instead of timestamp or UUID order",
    );
  } finally {
    await client.query("ROLLBACK");
  }
}
