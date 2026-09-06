import { randomUUID } from "node:crypto";
import {
  createTranslationTransferUseCases,
  createTranslationWorkspaceUseCases,
  createContentAuthoringUseCases,
  createBaseContentUseCases,
  createAdminPreviewMediaUseCases,
} from "../../application/dist/index.js";

/** Real PostgreSQL extension of the shared migration/identity fixture harness. */
export async function verifyAdminTranslationCases({
  client,
  persistence,
  fixtures,
  credentials,
  tokenPepper,
  check,
}) {
  const transfer = createTranslationTransferUseCases({
    transactions: persistence.translationTransferTransactionManager,
    tokenPepper,
  });
  const workspace = createTranslationWorkspaceUseCases({
    transactions: persistence.translationWorkspaceTransactionManager,
    tokenPepper,
  });
  const authoring = createContentAuthoringUseCases({
    transactions: persistence.contentAuthoringTransactionManager,
    tokenPepper,
  });
  const base = createBaseContentUseCases({
    transactions: persistence.baseContentTransactionManager,
    tokenPepper,
  });
  const execute = (app, command, actor = "editor") =>
    app.execute({
      schemaVersion: 1,
      requestId: randomUUID(),
      ...credentials[actor],
      command: { schemaVersion: 1, ...command },
    });
  const success = (value, label) => {
    if (value.outcome !== "SUCCESS")
      process.stderr.write(
        JSON.stringify({
          stage: "translation",
          label,
          code: value.code ?? "UNKNOWN",
        }) + "\n",
      );
    check(value.outcome, "SUCCESS", label);
    return value;
  };
  let policyRevision;
  for (const [key, owner] of Object.entries(fixtures.targets)) {
    const target = { owner, revisionId: fixtures.revisions[key] };
    const exportedCommand = {
      action: "EXPORT",
      target,
      locales: ["ja"],
      reasonCode: "TRANSLATION_FIXTURE",
      idempotencyKey: randomUUID(),
    };
    const exported = success(
      await execute(transfer, exportedCommand),
      `${key}: actual export succeeds`,
    );
    check(
      exported.package.entries.map((row) => row.locale),
      ["ja"],
      `${key}: export includes exact requested locale`,
    );
    check(
      exported.package.english.text.kind,
      owner.kind,
      `${key}: export contains real English of matching kind`,
    );
    const replayedExport = success(
      await execute(transfer, exportedCommand),
      `${key}: export replays`,
    );
    check(
      replayedExport.package,
      exported.package,
      `${key}: replay returns identical immutable package`,
    );
    check(replayedExport.replayed, true, `${key}: replay marker`);
    const packet = globalThis.structuredClone(exported.package),
      entry = packet.entries[0];
    const field =
      owner.kind === "IDOL"
        ? "displayName"
        : owner.kind === "HOMEPAGE"
          ? "heroTitle"
          : owner.kind === "MEDIA_METADATA"
            ? "alt"
            : "title";
    entry.text.fields[field] += " imported";
    const importedCommand = {
      action: "IMPORT",
      package: packet,
      reasonCode: "TRANSLATION_FIXTURE",
      idempotencyKey: randomUUID(),
    };
    const imported = success(
      await execute(transfer, importedCommand),
      `${key}: actual immutable import succeeds`,
    );
    check(
      imported.resultId !== target.revisionId,
      true,
      `${key}: import creates another revision`,
    );
    const view = success(
      await execute(workspace, {
        action: "READ",
        target: { owner, revisionId: imported.resultId, locale: "ja" },
      }),
      `${key}: workspace opens imported revision`,
    );
    check(
      view.selected.context.audit.origin,
      "IMPORT",
      `${key}: origin records import`,
    );
    check(
      view.selected.context.audit.review.status,
      "DRAFT",
      `${key}: import never approves`,
    );
    check(
      view.selected.content.fields[field],
      entry.text.fields[field],
      `${key}: imported raw content survives`,
    );
    check(view.cells.length, 7, `${key}: matrix contains seven locales`);
    const replayed = success(
      await execute(transfer, importedCommand),
      `${key}: stale-head same key replays after current authorization`,
    );
    check(
      replayed.resultId,
      imported.resultId,
      `${key}: import replay cannot create another revision`,
    );
    check(replayed.replayed, true, `${key}: import replay marker`);
    check(
      (
        await execute(transfer, {
          ...importedCommand,
          idempotencyKey: randomUUID(),
        })
      ).code,
      "STALE_VERSION",
      `${key}: old package with new key is rejected`,
    );
    const altered = globalThis.structuredClone(importedCommand);
    altered.package.entries[0].text.fields[field] += " changed";
    check(
      (await execute(transfer, altered)).code,
      "IDEMPOTENCY_CONFLICT",
      `${key}: another raw body cannot replay`,
    );
    check(
      (await execute(transfer, importedCommand, "denied")).code,
      "FORBIDDEN",
      `${key}: current authorization precedes receipt and replay`,
    );
    const full = success(
      await execute(authoring, {
        action: "READ",
        target: owner,
        revisionId: imported.resultId,
      }),
      `${key}: canonical authoring read`,
    );
    const english = globalThis.structuredClone(
      full.snapshot.content.translations.find((row) => row.locale === "en"),
    );
    english.fields[field] += " new source";
    const next = success(
      await execute(authoring, {
        action: "COPY",
        target: owner,
        sourceRevisionId: imported.resultId,
        expectedVersion: full.snapshot.headVersion,
        expectedSourceHash: full.snapshot.contentHash,
        changes: { kind: owner.kind, translations: [english] },
        reasonCode: "SOURCE_DIFF_FIXTURE",
        idempotencyKey: randomUUID(),
      }),
      `${key}: English change creates a new revision`,
    );
    const stale = success(
      await execute(workspace, {
        action: "READ",
        target: { owner, revisionId: next.resultId, locale: "ja" },
      }),
      `${key}: stale translation stays readable`,
    );
    check(
      stale.selected.context.stale,
      true,
      `${key}: stale state derives from English lineage`,
    );
    check(
      stale.sourceDiff.status,
      "AVAILABLE",
      `${key}: source diff follows a real COPY edge`,
    );
    check(
      stale.sourceDiff.previous.sourceHash,
      exported.package.english.sourceHash,
      `${key}: old English proof matches translation origin`,
    );
    check(
      stale.sourceDiff.changedPaths.includes(field),
      true,
      `${key}: diff identifies the actual changed field`,
    );
    if (key === "policy") policyRevision = next.resultId;
  }
  const policyOwner = fixtures.targets.policy;
  const fresh = success(
    await execute(transfer, {
      action: "EXPORT",
      target: { owner: policyOwner, revisionId: policyRevision },
      locales: ["ja"],
      reasonCode: "ROLLBACK_FIXTURE",
      idempotencyKey: randomUUID(),
    }),
    "rollback test export",
  );
  const command = {
    action: "IMPORT",
    package: fresh.package,
    reasonCode: "ROLLBACK_FIXTURE",
    idempotencyKey: randomUUID(),
  };
  const before = (
    await client.query(
      "SELECT (SELECT count(*) FROM public.policy_revisions) AS revisions,(SELECT count(*) FROM public.translation_import_receipts) AS receipts,(SELECT count(*) FROM public.audit_logs) AS audits",
    )
  ).rows[0];
  const failing = createTranslationTransferUseCases({
    tokenPepper,
    transactions: {
      runInTranslationTransferTransaction: (work) =>
        persistence.translationTransferTransactionManager.runInTranslationTransferTransaction(
          (repositories) =>
            work({
              ...repositories,
              translationTransfers: {
                ...repositories.translationTransfers,
                async recordImport(input) {
                  await repositories.translationTransfers.recordImport(input);
                  throw new Error("synthetic rollback");
                },
              },
            }),
        ),
    },
  });
  check(
    (await execute(failing, command)).code,
    "CONTENT_UNAVAILABLE",
    "failure after receipt is safely reported",
  );
  check(
    (
      await client.query(
        "SELECT (SELECT count(*) FROM public.policy_revisions) AS revisions,(SELECT count(*) FROM public.translation_import_receipts) AS receipts,(SELECT count(*) FROM public.audit_logs) AS audits",
      )
    ).rows[0],
    before,
    "new revision, import receipt and audit all roll back",
  );
  success(
    await execute(transfer, command),
    "same key recovers after rolled-back failure",
  );
  // URL signing is intentionally a narrow adapter here; actual S3 delivery remains in the HTTP/browser harness.
  const mediaTarget = {
    owner: fixtures.targets.media,
    revisionId: fixtures.revisions.media,
    locale: "ja",
  };
  const grant = success(
    await execute(base, {
      action: "ISSUE_PREVIEW",
      target: mediaTarget,
      ttlSeconds: 300,
      reasonCode: "PREVIEW_FIXTURE",
    }),
    "actual scoped preview grant",
  );
  let downloads = 0;
  const preview = createAdminPreviewMediaUseCases({
    tokenPepper,
    transactions: persistence.adminPreviewMediaTransactionManager,
    storage: {
      async createDownloadGrant(input) {
        downloads++;
        return {
          schemaVersion: 1,
          operation: input.operation,
          outcome: "SUCCESS",
          value: {
            method: "GET",
            storageClass: input.storageClass,
            objectKey: input.objectKey,
            url: "https://media.example.test/private-preview?fixture=1",
            headers: {},
            expiresAt: input.expiresAt,
          },
        };
      },
    },
  });
  const images = success(
    await preview.execute({
      schemaVersion: 1,
      target: mediaTarget,
      token: grant.token,
    }),
    "actual grant resolves only referenced metadata media",
  );
  check(
    images.images.every(
      (image) =>
        image.assetId === mediaTarget.owner.mediaAssetId &&
        image.metadataRevisionId === mediaTarget.revisionId,
    ),
    true,
    "resolved images remain inside the exact root reference",
  );
  check(
    downloads > 0,
    true,
    "qualified actual media produces a signed download request",
  );
  success(
    await execute(base, {
      action: "REVOKE_PREVIEW",
      grantId: grant.grantId,
      reasonCode: "PREVIEW_FIXTURE",
      idempotencyKey: randomUUID(),
    }),
    "actual preview revocation",
  );
  check(
    (
      await preview.execute({
        schemaVersion: 1,
        target: mediaTarget,
        token: grant.token,
      })
    ).code,
    "PREVIEW_UNAVAILABLE",
    "revoked image grant is unavailable",
  );
}
