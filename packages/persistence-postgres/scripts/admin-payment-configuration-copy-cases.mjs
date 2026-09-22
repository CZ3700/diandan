import { randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";

/** TEST-only actual PostgreSQL cases. No publication is changed by this suite. */
export async function verifyPaymentConfigurationCopies({
  client,
  check,
  execute,
  actors,
  deployed,
  published,
  success,
}) {
  const workspace = success(
    await execute({ action: "READ", revisionId: published.revisionId }),
    "copy source workspace",
  );
  const original = workspace.selected.configuration;
  const approvalCount = async () =>
    Number(
      (
        await client.query(
          "SELECT count(*) n FROM audit_logs WHERE action='PAYMENT_CONFIGURATION_APPROVE'",
        )
      ).rows[0].n,
    );
  const approvalsBefore = await approvalCount();
  const save = async (configuration, sourceRevisionId = published.revisionId) =>
    success(
      await execute({
        action: "SAVE",
        sourceRevisionId,
        expectedPublicationId: published.publicationId,
        idempotencyKey: randomUUID(),
        configuration,
      }),
      "copy draft save",
    );
  const read = async (result) =>
    success(
      await execute({ action: "READ", revisionId: result.revisionId }),
      "copy draft read",
    );
  const validate = async (result) =>
    success(
      await execute({
        action: "VALIDATE",
        revisionId: result.revisionId,
        expectedPublicationId: published.publicationId,
        mode: "PUBLISH",
      }),
      "copy draft validation",
    );

  const settings = globalThis.structuredClone(original);
  settings.channels[0].rolloutBasisPoints = 4321;
  settings.routes[0].priority += 1;
  const copied = await save(settings),
    copiedWorkspace = await read(copied);
  check(
    copiedWorkspace.selected.reviews.every((r) => r.status === "APPROVED"),
    "unchanged published copy preserves independent approval when only routing changes",
  );
  check(
    copiedWorkspace.selected.reviews.every(
      (r) => r.editorId === actors[0].id && r.reviewerId === actors[1].id,
    ),
    "copy retains actual original author and independent reviewer",
  );
  check(
    (await validate(copied)).valid,
    "copied approval permits rule-only publication validation without repeated review",
  );
  check(
    (await approvalCount()) === approvalsBefore,
    "copy does not claim a new human approval audit",
  );
  const proofRows = (
    await client.query(
      `SELECT c.*,t.config_version_id,t.locale FROM admin_payment_configuration_translation_copies c JOIN payment_provider_config_translations t ON t.id=c.target_translation_id WHERE t.config_version_id=$1`,
      [copied.revisionId],
    )
  ).rows;
  check(
    proofRows.length === original.channels[0].translations.length,
    "every inherited translation has exact durable copy evidence",
  );
  const sameEvidence = (
    await client.query(
      `SELECT bool_and(s.editor_id=t.editor_id AND s.edited_at=t.edited_at AND s.source_hash=t.source_hash AND s.translated_from_source_hash=t.translated_from_source_hash AND s.display_name=t.display_name AND s.customer_hint=t.customer_hint AND r.reviewer_id=old.reviewer_id AND r.reviewed_at=old.reviewed_at AND r.reviewed_source_hash=old.reviewed_source_hash AND r.reviewed_content_hash=old.reviewed_content_hash) exact FROM admin_payment_configuration_translation_copies c JOIN payment_provider_config_translations s ON s.id=c.source_translation_id JOIN payment_provider_config_translations t ON t.id=c.target_translation_id JOIN payment_provider_config_translation_reviews old ON old.id=c.source_approval_review_id JOIN payment_provider_config_translation_reviews r ON r.provider_config_translation_id=t.id AND r.status='APPROVED' WHERE t.config_version_id=$1`,
      [copied.revisionId],
    )
  ).rows[0].exact;
  check(
    sameEvidence === true,
    "copy keeps original signed-off text hashes and historical review time",
  );

  const targetLocale = original.channels[0].translations.find(
    (t) => t.locale !== "en",
  ).locale;
  const altered = globalThis.structuredClone(original);
  altered.channels[0].translations.find(
    (t) => t.locale === targetLocale,
  ).customerHint += " changed";
  const alteredDraft = await save(altered),
    alteredWorkspace = await read(alteredDraft);
  check(
    alteredWorkspace.selected.reviews.find((r) => r.locale === targetLocale)
      .status === "DRAFT",
    "changed localized text never inherits approval",
  );
  check(
    alteredWorkspace.selected.reviews
      .filter((r) => r.locale !== targetLocale)
      .every((r) => r.status === "APPROVED"),
    "other exactly matching translations retain their review evidence",
  );
  check(
    !(await validate(alteredDraft)).valid,
    "one changed unreviewed translation blocks publication",
  );

  const english = globalThis.structuredClone(original);
  english.channels[0].translations.find(
    (t) => t.locale === "en",
  ).customerHint += " source changed";
  const changedSource = await save(english),
    sourceWorkspace = await read(changedSource);
  check(
    sourceWorkspace.selected.reviews.every((r) => r.status !== "APPROVED"),
    "English changes invalidate every dependent approval",
  );
  check(
    sourceWorkspace.selected.reviews.some((r) => r.status === "STALE"),
    "old translated-from hashes remain visibly stale",
  );
  check(!(await validate(changedSource)).valid, "stale source cannot publish");

  const unpublished = await save(
      copiedWorkspace.selected.configuration,
      copied.revisionId,
    ),
    unpublishedWorkspace = await read(unpublished);
  check(
    unpublishedWorkspace.selected.reviews.every((r) => r.status === "DRAFT"),
    "unpublished source cannot confer inherited approval even when it has copy evidence",
  );
  const noSource = await save(original, null),
    noSourceWorkspace = await read(noSource);
  check(
    noSourceWorkspace.selected.reviews.every((r) => r.status === "DRAFT"),
    "matching text without an explicit published source starts unapproved",
  );

  const accountId = randomUUID();
  const sourceAccount = original.channels[0].providerAccountId;
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO payment_provider_accounts(id,merchant_entity_id,adapter_key,environment,account_reference_digest,credential_secret_ref,status) SELECT $1,merchant_entity_id,adapter_key,environment,$2,$3,'ACTIVE' FROM payment_provider_accounts WHERE id=$4`,
      [
        accountId,
        randomBytes(32),
        `secret-ref:v1:aws-sm:test/payment/${accountId}`,
        sourceAccount,
      ],
    );
    await client.query(
      `INSERT INTO payment_provider_health_events(id,provider_account_id,sequence,from_status,to_status,observer_kind,task_name,reason_code,request_id,correlation_id) VALUES($1,$2,1,NULL,'HEALTHY','SYSTEM','configuration-copy-test','SYNTHETIC_TEST_HEALTH',$3,$4)`,
      [randomUUID(), accountId, randomUUID(), randomUUID()],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  deployed.push({
    ...deployed.find((d) => d.providerAccountId === sourceAccount),
    providerAccountId: accountId,
  });
  const differentAccount = globalThis.structuredClone(original);
  for (const channel of differentAccount.channels)
    channel.providerAccountId = accountId;
  for (const route of differentAccount.routes)
    route.providerAccountId = accountId;
  const other = await save(differentAccount),
    otherWorkspace = await read(other);
  check(
    otherWorkspace.selected.reviews.every((r) => r.status === "DRAFT"),
    "text belonging to another account cannot inherit approval",
  );

  const rejectsTransaction = async (sql, params, label) => {
    await client.query("BEGIN");
    let rejected = false;
    try {
      await client.query(sql, params);
      await client.query("COMMIT");
    } catch (error) {
      rejected = true;
      check(
        ["23514", "55000"].includes(error.code),
        `${label} fails its invariant`,
      );
    } finally {
      await client.query("ROLLBACK");
    }
    check(rejected, label);
  };
  await rejectsTransaction(
    "UPDATE admin_payment_configuration_translation_copies SET created_at=created_at+interval '1 second' WHERE target_translation_id=$1",
    [proofRows[0].target_translation_id],
    "copy proof cannot be edited",
  );
  await rejectsTransaction(
    "DELETE FROM admin_payment_configuration_translation_copies WHERE target_translation_id=$1",
    [proofRows[0].target_translation_id],
    "copy proof cannot be deleted",
  );
  await rejectsTransaction(
    "TRUNCATE admin_payment_configuration_translation_copies",
    [],
    "copy proof cannot be truncated",
  );
  const target = (
    await client.query(
      "SELECT id FROM payment_provider_config_translations WHERE config_version_id=$1 AND locale=$2",
      [alteredDraft.revisionId, targetLocale],
    )
  ).rows[0].id;
  const saveReceipt = (
    await client.query(
      "SELECT id,created_at::text created_at FROM admin_payment_configuration_receipts WHERE config_version_id=$1 AND action='SAVE'",
      [alteredDraft.revisionId],
    )
  ).rows[0];
  await rejectsTransaction(
    `INSERT INTO admin_payment_configuration_translation_copies(target_translation_id,source_translation_id,source_approval_review_id,save_receipt_id,created_at) SELECT $1,source_translation_id,source_approval_review_id,$2,$3 FROM admin_payment_configuration_translation_copies WHERE target_translation_id=$4`,
    [
      target,
      saveReceipt.id,
      saveReceipt.created_at,
      proofRows.find((r) => r.locale === targetLocale).target_translation_id,
    ],
    "forged approval for changed text is rejected in PostgreSQL",
  );
  check(
    (await approvalCount()) === approvalsBefore,
    "all copy cases preserve original human approval audit count",
  );
  assert.equal(
    (
      await client.query(
        "SELECT publication_id FROM payment_config_publication_heads",
      )
    ).rows[0].publication_id,
    published.publicationId,
    "copy tests do not change the active payment configuration",
  );
  return {
    publicationId: published.publicationId,
    revisionId: published.revisionId,
  };
}
