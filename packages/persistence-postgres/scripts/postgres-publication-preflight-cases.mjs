import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";
import { evaluatePublicationPreflight } from "@fan-support/content";
import { createPublicationPreflightRepository } from "../dist/publication-preflight-repository.js";
import { seedContentAuthoringPolicySource } from "./postgres-content-authoring-fixtures.mjs";

export async function verifyPublicationPreflightCases({
  client,
  clientConfig,
  persistence,
  fixtures,
  equal,
}) {
  const run = (work) =>
    persistence.publicationPreflightTransactionManager.runInPublicationPreflightTransaction(
      work,
    );
  const author = (work) =>
    persistence.contentAuthoringTransactionManager.runInContentAuthoringTransaction(
      work,
    );
  const load = (owner, revisionId, action = "PUBLISH") =>
    run(({ publicationPreflight }) =>
      publicationPreflight.load({
        schemaVersion: 1,
        target: { owner, revisionId },
        action,
      }),
    );
  function success(value, label) {
    equal(value.outcome, "SUCCESS", label);
    return value;
  }
  async function write(command) {
    return success(
      await author(({ contentAuthoring }) =>
        contentAuthoring.write({
          schemaVersion: 1,
          actorId: fixtures.editor,
          requestId: randomUUID(),
          command: {
            ...command,
            schemaVersion: 1,
            reasonCode: "PREFLIGHT_CASE",
            idempotencyKey: randomUUID(),
          },
        }),
      ),
      "case authoring write",
    ).resultId;
  }
  async function current(owner, revisionId) {
    return success(
      await author(({ contentAuthoring }) =>
        contentAuthoring.read({
          schemaVersion: 1,
          action: "READ",
          target: owner,
          revisionId,
        }),
      ),
      "case source snapshot",
    ).snapshot;
  }
  async function report(owner, revisionId, action = "PUBLISH") {
    const loaded = success(
      await load(owner, revisionId, action),
      "negative input remains a readable canonical context",
    );
    return success(
      evaluatePublicationPreflight(loaded.context),
      "pure diagnostic is available",
    );
  }
  for (const [key, owner] of Object.entries(fixtures.targets)) {
    const source = await current(owner, fixtures.revisions[key]);
    const missingId = await write({
      action: "CREATE",
      target: owner,
      expectedVersion: source.headVersion,
      content: {
        ...source.content,
        translations: source.content.translations.filter(
          (row) => row.locale === "en",
        ),
      },
    });
    const missing = await report(owner, missingId);
    equal(missing.ready, false, `${key} cannot publish one locale`);
    equal(
      missing.issues.some((issue) => issue.code === "TRANSLATION_MISSING"),
      true,
      `${key} reports actual missing locales`,
    );
    const head = await current(owner, fixtures.revisions[key]);
    const english = head.content.translations.find(
      (row) => row.locale === "en",
    );
    const field = {
      idol: "shortBio",
      gift: "shortDescription",
      homepage: "heroTitle",
      policy: "title",
      media: "alt",
    }[key];
    const staleId = await write({
      action: "COPY",
      target: owner,
      expectedVersion: head.headVersion,
      sourceRevisionId: head.revisionId,
      expectedSourceHash: head.contentHash,
      changes: {
        kind: owner.kind,
        translations: [
          {
            ...english,
            fields: {
              ...english.fields,
              [field]: `${english.fields[field]} revised`,
            },
          },
        ],
      },
    });
    const stale = await report(owner, staleId);
    equal(stale.ready, false, `${key} cannot publish stale translations`);
    equal(
      stale.issues.some((issue) => issue.code === "TRANSLATION_STALE"),
      true,
      `${key} identifies a source hash mismatch`,
    );
  }
  for (const key of ["idol", "gift"]) {
    const owner = fixtures.targets[key],
      source = await current(owner, fixtures.revisions[key]);
    const id = await write({
      action: "COPY",
      target: owner,
      expectedVersion: source.headVersion,
      sourceRevisionId: source.revisionId,
      expectedSourceHash: source.contentHash,
      changes: { kind: owner.kind },
    });
    const value = await report(owner, id);
    equal(value.ready, false, `${key} copied extension is not approved`);
    equal(
      value.issues.some((issue) => issue.code === "EXTENSION_NOT_APPROVED"),
      true,
      `${key} requires new independent extension review`,
    );
  }
  equal(
    (await load(fixtures.targets.idol, randomUUID())).code,
    "NOT_FOUND",
    "missing revision stays not found",
  );
  equal(
    (await load(fixtures.targets.gift, fixtures.revisions.idol)).code,
    "NOT_FOUND",
    "cross-kind revision cannot be loaded",
  );
  const unpublished = success(
    await load(fixtures.targets.policy, fixtures.revisions.policy, "ROLLBACK"),
    "draft rollback context",
  );
  equal(
    unpublished.context.previousPublication,
    null,
    "unpublished revision has no fabricated ledger proof",
  );
  equal(
    evaluatePublicationPreflight(unpublished.context).ready,
    false,
    "unpublished rollback cannot become ready",
  );
  const historical = success(
    await load(
      fixtures.targets.idol,
      fixtures.approvedSourceRevisionIds.idol,
      "ROLLBACK",
    ),
    "historical ledger context",
  );
  equal(
    historical.context.previousPublication.publicationId,
    fixtures.catalog.idols[0].publicationId,
    "history uses exact persisted publication ID",
  );
  equal(
    evaluatePublicationPreflight(historical.context).ready,
    false,
    "currently selected published revision is not a rollback target",
  );

  const draftGiftId = randomUUID(),
    pausedVariantId = randomUUID();
  await client.query(
    "INSERT INTO public.gifts(id,handle,status) VALUES($1,$2,'draft')",
    [draftGiftId, `preflight-${draftGiftId}`],
  );
  await client.query(
    "INSERT INTO public.gift_variants(id,gift_id,sku,status,inventory_policy) VALUES($1,$2,$3,'paused','PROCURE_ON_DEMAND')",
    [
      pausedVariantId,
      draftGiftId,
      `PREFLIGHT-${pausedVariantId.toUpperCase()}`,
    ],
  );
  const draftOwner = { kind: "GIFT", giftId: draftGiftId };
  const giftContent = {
    ...fixtures.content.gift,
    translations: fixtures.content.gift.translations.map((row) => ({
      ...row,
      fields: {
        ...row.fields,
        variantLabels: [
          { giftVariantId: pausedVariantId, label: "Paused test variant" },
        ],
      },
    })),
  };
  const draftGiftRevisionId = await write({
    action: "CREATE",
    target: draftOwner,
    expectedVersion: 0,
    content: giftContent,
  });
  const draftGift = success(
    await load(draftOwner, draftGiftRevisionId),
    "draft operational candidate",
  );
  equal(
    draftGift.context.candidate.base.status,
    "draft",
    "candidate retains actual draft operational status",
  );
  equal(
    draftGift.context.candidate.targetOperationalStatus,
    "active",
    "draft publication checks conservative active requirements",
  );
  equal(
    evaluatePublicationPreflight(draftGift.context).issues.some(
      (issue) => issue.code === "VARIANT_SELLABLE_MISSING",
    ),
    true,
    "only paused variants cannot satisfy draft active preflight",
  );

  // Fixed future history models a wall-clock rollback without changing the machine clock.
  const {
    rows: [future],
  } = await client.query(`SELECT
    to_char((date_trunc('second',clock_timestamp())+interval '1 hour 0.123456 second') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created,
    to_char((date_trunc('second',clock_timestamp())+interval '1 hour 1 minute 0.123456 second') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS edited,
    to_char((date_trunc('second',clock_timestamp())+interval '1 hour 2 minutes 0.123456 second') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS submitted,
    to_char((date_trunc('second',clock_timestamp())+interval '1 hour 3 minutes 0.123456 second') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS reviewed`);
  await client.query("BEGIN");
  const futureSource = await seedContentAuthoringPolicySource(client, {
    editor: fixtures.editor,
    reviewer: fixtures.reviewer,
    timeline: future,
  });
  await client.query("COMMIT");
  const futureSnapshot = await current(
    futureSource.target,
    futureSource.revisionId,
  );
  const futureId = await write({
    action: "COPY",
    target: futureSource.target,
    expectedVersion: 1,
    sourceRevisionId: futureSnapshot.revisionId,
    expectedSourceHash: futureSnapshot.contentHash,
    changes: { kind: "POLICY" },
  });
  const futureResult = success(
    await load(futureSource.target, futureId),
    "future persisted history can be diagnosed",
  );
  const {
    rows: [causal],
  } = await client.query(
    "SELECT $1::timestamptz >= $2::timestamptz AS causal,$1::timestamptz > clock_timestamp() AS historical_clock",
    [futureResult.context.evaluatedAt, future.reviewed],
  );
  equal(
    causal,
    { causal: true, historical_clock: true },
    "evaluation uses exact persisted causal lower bound after clock rollback",
  );
  equal(
    futureResult.context.snapshot.translationAudits[0].review.reviewedAt.includes(
      ".123456",
    ),
    true,
    "future review evidence keeps all six fractional digits",
  );

  // A new connection with a different timezone must produce the same canonical digest.
  const baseline = success(
    await load(fixtures.targets.gift, fixtures.revisions.gift),
    "baseline snapshot",
  );
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  await client.query("SET LOCAL TIME ZONE 'Asia/Bangkok'");
  const direct = createPublicationPreflightRepository(client, {
    trackOperation: (work) => work(),
  });
  const zoned = success(
    await direct.load({
      schemaVersion: 1,
      target: {
        owner: fixtures.targets.gift,
        revisionId: fixtures.revisions.gift,
      },
      action: "PUBLISH",
    }),
    "non-UTC connection snapshot",
  );
  equal(
    zoned.context.snapshot.contentHash,
    baseline.context.snapshot.contentHash,
    "timezone cannot change canonical snapshot hash",
  );
  equal(
    zoned.context.copies,
    baseline.context.copies,
    "timezone cannot change exact copy edges",
  );
  await client.query("ROLLBACK");

  // Verify physical parent locking, without mutating or depending on a guessed delay.
  const contender = new Client(clientConfig);
  await contender.connect();
  await contender.query("BEGIN");
  const {
    rows: [{ pid }],
  } = await contender.query("SELECT pg_backend_pid() AS pid");
  let releaseReader, announceLoaded;
  const readerGate = new Promise((resolve) => {
    releaseReader = resolve;
  });
  const loadedGate = new Promise((resolve) => {
    announceLoaded = resolve;
  });
  const held = run(async ({ publicationPreflight }) => {
    const result = await publicationPreflight.load({
      schemaVersion: 1,
      target: {
        owner: fixtures.targets.idol,
        revisionId: fixtures.revisions.idol,
      },
      action: "PUBLISH",
    });
    announceLoaded();
    await readerGate;
    return result;
  });
  try {
    await loadedGate;
    const waiting = contender.query(
      "SELECT id FROM public.idols WHERE id=$1 FOR UPDATE",
      [fixtures.targets.idol.idolId],
    );
    const deadline = performance.now() + 6000;
    for (;;) {
      const {
        rows: [state],
      } = await client.query(
        "SELECT cardinality(pg_blocking_pids($1))>0 AS blocked",
        [pid],
      );
      if (state.blocked) break;
      if (performance.now() >= deadline)
        throw new Error("Parent lock was not observed");
      await delay(20);
    }
    equal(
      true,
      true,
      "preflight holds the canonical owner against concurrent authoring",
    );
    releaseReader();
    success(await held, "held canonical reader completes");
    await waiting;
  } finally {
    releaseReader();
    await contender.query("ROLLBACK");
    await contender.end();
  }

  async function state() {
    const tables = [
      "content_publications",
      "audit_logs",
      "outbox_events",
      "content_authoring_receipts",
      "base_content_review_receipts",
      "idol_translation_search_projections",
    ];
    const counts = {};
    for (const table of tables)
      counts[table] = (
        await client.query(`SELECT count(*)::int AS count FROM public.${table}`)
      ).rows[0].count;
    return counts;
  }
  const before = await state();
  for (const [key, owner] of Object.entries(fixtures.targets))
    await report(owner, fixtures.revisions[key]);
  equal(
    await state(),
    before,
    "preflight leaves publications, audits, outbox, receipts and search projection untouched",
  );
  let gateError;
  await client.query("BEGIN");
  try {
    await client.query(
      "UPDATE public.idol_revisions SET lifecycle='VALIDATED',validated_at=GREATEST(clock_timestamp(),created_at) WHERE id=$1",
      [fixtures.revisions.idol],
    );
  } catch (error) {
    gateError = error.code;
  } finally {
    await client.query("ROLLBACK");
  }
  equal(
    gateError,
    "55000",
    "existing extension publication gate still rejects a real transition",
  );
}
