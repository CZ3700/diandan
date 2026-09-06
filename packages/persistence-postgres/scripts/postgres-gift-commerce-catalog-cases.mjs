import { randomUUID } from "node:crypto";
import { createGiftCommerceCatalogRepository } from "../dist/gift-commerce-gift-repository.js";
import { createGiftCommerceAuthorizationRepository } from "../dist/gift-commerce-authorization-repository.js";
import { createContentAuthoringRepository } from "../dist/content-authoring-repository.js";
import {
  computeGiftRevisionProfileHash,
  readGiftRevisionProfile,
} from "../dist/gift-commerce-gift-profile.js";

export async function verifyGiftCommerceCatalogCases({
  client,
  scope,
  fixtures,
  credentials,
  check,
  tx,
}) {
  const repository = createGiftCommerceCatalogRepository(
    client,
    scope,
    "https://media.example.test",
  );
  const authorization = createGiftCommerceAuthorizationRepository(
    client,
    scope,
  );
  const sourceRepository = createContentAuthoringRepository(client, scope);
  const write = async (command) =>
    tx(async () => {
      const authorized = await authorization.authorize({
        schemaVersion: 1,
        sessionTokenDigest: credentials.sessionTokenDigest,
        csrfTokenDigest: credentials.csrfTokenDigest,
        permission: "gift.manage",
        locales: [],
      });
      check(
        authorized.outcome,
        "SUCCESS",
        "gift operation has canonical current authority",
      );
      return repository.write({
        schemaVersion: 1,
        requestId: randomUUID(),
        principal: authorized.principal,
        command: {
          schemaVersion: 1,
          reasonCode: "COMMERCE_VERIFICATION",
          idempotencyKey: randomUUID(),
          ...command,
        },
      });
    });
  const read = (giftId, revisionId) =>
    tx(() =>
      repository.read({
        schemaVersion: 1,
        action: "READ_GIFT",
        giftId,
        locale: "ja",
        ...(revisionId ? { revisionId } : {}),
      }),
    );
  const suffix = randomUUID().replaceAll("-", "");
  const created = await write({
    action: "CREATE_GIFT",
    handle: `operator-gift-${suffix}`,
    expectedBaseVersion: 0,
  });
  check(
    created.outcome,
    "SUCCESS",
    "gift identity created only as audited draft",
  );
  const giftId = created.giftId;
  let view = await read(giftId);
  check(
    [
      view.value.gift.status,
      view.value.gift.version,
      view.value.authoringVersion,
      view.value.selectedProfile,
    ],
    ["draft", 1, 0, null],
    "empty identity has no invented content or classification",
  );
  check(
    (
      await write({
        action: "SET_GIFT_STATUS",
        giftId,
        expectedBaseVersion: 1,
        status: "active",
      })
    ).code,
    "GIFT_NOT_READY",
    "unpublished gift cannot be activated",
  );
  const {
    rows: [idol],
  } = await client.query(
    "SELECT id FROM public.idols WHERE status='active' AND published_revision_id IS NOT NULL ORDER BY id LIMIT 1",
  );
  const variantCommand = {
    action: "SAVE_VARIANT",
    giftId,
    giftVariantId: null,
    expectedBaseVersion: 1,
    expectedVariantVersion: 0,
    sku: `OP-${suffix.toUpperCase()}`,
    status: "draft",
    inventoryPolicy: "PROCURE_ON_DEMAND",
    eligibleIdolIds: [idol.id],
  };
  const variant = await write(variantCommand);
  check(
    variant.outcome,
    "SUCCESS",
    "stock-free gift variant created through audited receipt",
  );
  view = await read(giftId);
  check(
    [
      view.value.variants[0].inventoryPolicy,
      view.value.variants[0].inventoryItemId,
      view.value.variants[0].eligibleIdolIds,
    ],
    ["PROCURE_ON_DEMAND", null, [idol.id]],
    "no fake inventory is created for repeated procurement",
  );
  check(
    (
      await write({
        ...variantCommand,
        giftVariantId: variant.giftVariantId,
        expectedVariantVersion: 0,
      })
    ).code,
    "INVALID_COMMAND",
    "existing variant never reuses creation version zero",
  );
  const {
    rows: [legacyEligibility],
  } = await client.query(
    "SELECT gift_variant_id FROM public.gift_variant_idol_eligibility WHERE idol_id=$1 AND gift_variant_id<>$2 ORDER BY gift_variant_id LIMIT 1",
    [idol.id, variant.giftVariantId],
  );
  check(
    Boolean(legacyEligibility),
    true,
    "ownership probe uses an existing legacy relation for the same idol",
  );
  let eligibilityMoveCode = null;
  await client.query("BEGIN");
  try {
    await client.query(
      "DELETE FROM public.gift_variant_idol_eligibility WHERE gift_variant_id=$1 AND idol_id=$2",
      [variant.giftVariantId, idol.id],
    );
    await client.query(
      "UPDATE public.gift_variant_idol_eligibility SET gift_variant_id=$1 WHERE gift_variant_id=$2 AND idol_id=$3",
      [variant.giftVariantId, legacyEligibility.gift_variant_id, idol.id],
    );
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  } catch (error) {
    eligibilityMoveCode = error.code;
  } finally {
    await client.query("ROLLBACK");
  }
  check(
    eligibilityMoveCode,
    "55000",
    "an existing receipt cannot authorize moving another variant's eligibility relation",
  );
  const {
    rows: [source],
  } = await client.query(
    "SELECT id,gift_id FROM public.gift_revisions WHERE profile_version=1 AND lifecycle='PUBLISHED' ORDER BY gift_id LIMIT 1",
  );
  const legacy = await tx(() =>
    sourceRepository.read({
      schemaVersion: 1,
      action: "READ",
      target: { kind: "GIFT", giftId: source.gift_id },
      revisionId: source.id,
    }),
  );
  check(
    legacy.outcome,
    "SUCCESS",
    "legacy authored source remains readable before migration copy",
  );
  const {
    rows: [legacyGift],
  } = await client.query(
    "SELECT g.id,g.version,p.proof_version FROM public.gifts g JOIN public.gift_publication_heads h ON h.gift_id=g.id JOIN public.content_publications p ON p.id=h.publication_id WHERE g.id=$1 AND g.status='active'",
    [source.gift_id],
  );
  check(
    legacyGift.proof_version,
    1,
    "legacy status probe uses a genuine v1 publication",
  );
  let legacyPaused;
  let legacyResume;
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const authorized = await authorization.authorize({
      schemaVersion: 1,
      sessionTokenDigest: credentials.sessionTokenDigest,
      csrfTokenDigest: credentials.csrfTokenDigest,
      permission: "gift.manage",
      locales: [],
    });
    const status = (value, expectedBaseVersion) =>
      repository.write({
        schemaVersion: 1,
        requestId: randomUUID(),
        principal: authorized.principal,
        command: {
          schemaVersion: 1,
          action: "SET_GIFT_STATUS",
          giftId: legacyGift.id,
          expectedBaseVersion,
          status: value,
          reasonCode: "LEGACY_MIGRATION_CHECK",
          idempotencyKey: randomUUID(),
        },
      });
    legacyPaused = await status("paused", Number(legacyGift.version));
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    legacyResume = await status("active", Number(legacyGift.version) + 1);
  } finally {
    await client.query("ROLLBACK");
  }
  check(
    legacyPaused.outcome,
    "SUCCESS",
    "legacy v1 gifts can still be paused with an audited receipt",
  );
  check(
    legacyResume.code,
    "GIFT_NOT_READY",
    "legacy v1 gifts require a new verified publication before resuming",
  );
  const content = {
    ...legacy.snapshot.content,
    translations: legacy.snapshot.content.translations.map((row) => ({
      locale: row.locale,
      origin: "HUMAN",
      fields: {
        ...row.fields,
        variantLabels: [
          {
            giftVariantId: variant.giftVariantId,
            label: row.fields.variantLabels[0].label,
          },
        ],
      },
    })),
  };
  const saved = await write({
    action: "SAVE_GIFT_CONTENT",
    expectedBaseVersion: 1,
    giftKind: "WISH",
    authoring: {
      schemaVersion: 1,
      action: "CREATE",
      target: { kind: "GIFT", giftId },
      expectedVersion: 0,
      content,
    },
  });
  check(
    saved.outcome,
    "SUCCESS",
    "new gift content and wish profile commit atomically",
  );
  view = await read(giftId);
  check(
    [
      view.value.gift.version,
      view.value.authoringVersion,
      view.value.selectedProfile.profile.giftKind,
    ],
    [2, 1, "WISH"],
    "identity version and content version remain independent",
  );
  const first = await tx(() =>
    sourceRepository.read({
      schemaVersion: 1,
      action: "READ",
      target: { kind: "GIFT", giftId },
      revisionId: saved.giftRevisionId,
    }),
  );
  check(
    first.snapshot.translationAudits.every(
      (row) => row.review.status === "DRAFT",
    ),
    true,
    "creating copied text never imports legacy approvals",
  );
  const copied = await tx(() =>
    sourceRepository.write({
      schemaVersion: 1,
      actorId: fixtures.editor,
      requestId: randomUUID(),
      command: {
        schemaVersion: 1,
        action: "COPY",
        target: { kind: "GIFT", giftId },
        sourceRevisionId: first.snapshot.revisionId,
        expectedVersion: 1,
        expectedSourceHash: first.snapshot.contentHash,
        changes: { kind: "GIFT" },
        reasonCode: "COMMERCE_COPY",
        idempotencyKey: randomUUID(),
      },
    }),
  );
  check(
    copied.outcome,
    "SUCCESS",
    "ordinary old authoring COPY preserves the new classification",
  );
  view = await read(giftId, saved.giftRevisionId);
  check(
    [
      view.value.authoringVersion,
      view.value.selectedRevisionId,
      view.value.selectedProfile.profile.giftKind,
      view.value.latestProfile.profile.giftKind,
    ],
    [2, saved.giftRevisionId, "WISH", "WISH"],
    "historical selection binds the selected profile instead of the latest row",
  );
  const profile = await tx(() =>
    readGiftRevisionProfile(client, giftId, copied.resultId),
  );
  const { profileHash, ...profileFields } = profile.profile;
  const {
    rows: [hashRow],
  } = await client.query(
    "SELECT public.gift_profile_hash($1,$2,$3,$4,$5) AS hash",
    [
      profileFields.giftId,
      profileFields.giftRevisionId,
      profileFields.giftKind,
      profileFields.createdBy,
      profileFields.createdAt,
    ],
  );
  check(
    hashRow.hash,
    computeGiftRevisionProfileHash(profileFields),
    "native PostgreSQL and TypeScript profile hashes match byte for byte",
  );
  check(hashRow.hash, profileHash, "stored profile hash is canonical");
  const latest = await tx(() =>
    sourceRepository.read({
      schemaVersion: 1,
      action: "READ",
      target: { kind: "GIFT", giftId },
      revisionId: copied.resultId,
    }),
  );
  const copyAgain = {
    schemaVersion: 1,
    actorId: fixtures.editor,
    requestId: randomUUID(),
    command: {
      schemaVersion: 1,
      action: "COPY",
      target: { kind: "GIFT", giftId },
      sourceRevisionId: copied.resultId,
      expectedVersion: 2,
      expectedSourceHash: latest.snapshot.contentHash,
      changes: { kind: "GIFT" },
      reasonCode: "COMMERCE_COPY",
      idempotencyKey: randomUUID(),
    },
  };
  for (const mode of ["MISSING", "WRONG_HASH", "WRONG_KIND"]) {
    const wrapped = {
      query: async (query, values) => {
        const text = typeof query === "string" ? query : query.text;
        if (text.startsWith("INSERT INTO public.gift_revision_profiles")) {
          if (mode === "MISSING") return { rows: [] };
          const modified = [...values];
          if (mode === "WRONG_HASH") modified[5] = "f".repeat(64);
          else {
            modified[2] = "VIRTUAL";
            modified[5] = computeGiftRevisionProfileHash({
              schemaVersion: 1,
              giftRevisionId: modified[0],
              giftId: modified[1],
              giftKind: modified[2],
              createdBy: modified[3],
              createdAt: modified[4],
            });
          }
          return client.query(query, modified);
        }
        return client.query(query, values);
      },
      release() {},
    };
    let rejected = false;
    try {
      await tx(() =>
        createContentAuthoringRepository(wrapped, scope).write(copyAgain),
      );
    } catch (error) {
      rejected =
        error.code === "23514" ||
        error.failure?.code === "INTEGRITY_VIOLATION" ||
        error.failure?.error?.code === "INTEGRITY_VIOLATION";
    }
    check(
      rejected,
      true,
      `${mode}: incomplete classification rolls back the full authoring transaction`,
    );
    check(
      (await read(giftId)).value.authoringVersion,
      2,
      `${mode}: no new revision survived rejection`,
    );
  }
  let immutable = false;
  try {
    await tx(() =>
      client.query(
        "UPDATE public.gift_revision_profiles SET gift_kind='VIRTUAL' WHERE gift_revision_id=$1",
        [saved.giftRevisionId],
      ),
    );
  } catch (error) {
    immutable = error.code === "55000";
  }
  check(
    immutable,
    true,
    "published or draft classification never mutates in place",
  );
  const replay = await tx(() =>
    repository.readReceipt({
      schemaVersion: 1,
      resultId: saved.resultId,
      actorId: fixtures.editor,
    }),
  );
  check(replay, saved, "safe profile receipt remains exact after later copies");
  check(
    (
      await tx(() =>
        repository.readReceipt({
          schemaVersion: 1,
          resultId: saved.resultId,
          actorId: fixtures.reviewer,
        }),
      )
    ).code,
    "NOT_FOUND",
    "classification receipt is actor scoped",
  );
  const archived = await write({
    action: "SET_GIFT_STATUS",
    giftId,
    expectedBaseVersion: 3,
    status: "archived",
  });
  check(
    archived.outcome,
    "SUCCESS",
    "unpublished gift can be archived with an audited reason",
  );
  check(
    (
      await write({
        ...variantCommand,
        giftVariantId: variant.giftVariantId,
        expectedVariantVersion: 1,
        expectedBaseVersion: 4,
      })
    ).code,
    "FORBIDDEN",
    "archived gift cannot regain purchasable variants",
  );
}
