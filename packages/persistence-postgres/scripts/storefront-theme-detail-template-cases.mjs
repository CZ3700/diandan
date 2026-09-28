import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createDefaultStorefrontTheme,
  createDefaultStorefrontPresentation,
  createDefaultStorefrontDetailTemplates,
  storefrontThemeSchema,
} from "@fan-support/contracts";

/** Exercise the third theme generation against real prior-generation history and commerce. */
export async function verifyStorefrontDetailTemplates({
  client,
  migrate,
  execute,
  publicApp,
  publicLayout,
  priorLayout,
  saveCommand,
  published,
  previousVersion,
  check,
}) {
  const legacy = createDefaultStorefrontTheme();
  const presentation = {
    ...createDefaultStorefrontPresentation(),
    heroLayout: "SPLIT",
    motion: "SUBTLE",
  };
  const templates = { artist: "SPLIT", gift: "IMAGE_RIGHT" };
  const detailOnly = { ...legacy, detailTemplates: templates };
  const combined = { ...legacy, presentation, detailTemplates: templates };
  const save = (theme, expectedVersion) => ({
    schemaVersion: 1,
    action: "SAVE_DRAFT",
    expectedVersion,
    idempotencyKey: randomUUID(),
    theme,
  });
  const publish = (saved) => ({
    schemaVersion: 1,
    action: "PUBLISH",
    expectedVersion: saved.state.version,
    draftRevisionId: saved.state.draft.revisionId,
    idempotencyKey: randomUUID(),
  });
  const restore = (publicationId, expectedVersion) =>
    execute({
      schemaVersion: 1,
      action: "RESTORE",
      publicationId,
      expectedVersion,
      idempotencyKey: randomUUID(),
    });
  // This receipt is committed on 0046, before the new validator exists.
  const presentationCommand = save(
    { ...legacy, presentation },
    previousVersion,
  );
  const presentationSaved = await execute(presentationCommand);
  check(
    presentationSaved.outcome === "SUCCESS",
    "0046 presentation draft committed before upgrade",
  );
  const presentationPublish = publish(presentationSaved);
  const presentationPublished = await execute(presentationPublish);
  check(
    presentationPublished.outcome === "SUCCESS",
    "0046 presentation publication committed before upgrade",
  );
  const historySnapshot = async () =>
    (
      await client.query(
        `SELECT 'revision' kind,id,to_jsonb(r) value FROM storefront_theme_revisions r UNION ALL SELECT 'publication',id,to_jsonb(p) FROM storefront_theme_publications p UNION ALL SELECT 'receipt',id,to_jsonb(c) FROM storefront_theme_receipts c ORDER BY kind,id`,
      )
    ).rows;
  const businessSnapshot = async () => {
    const tables = [
      "gifts",
      "gift_variants",
      "prices",
      "price_books",
      "price_book_publications",
      "price_book_publication_heads",
      "inventory_items",
      "inventory_balances",
      "inventory_ledger",
      "orders",
      "order_items",
    ];
    const result = [];
    for (const table of tables)
      result.push({
        table,
        rows: (
          await client.query(
            `SELECT to_jsonb(t) value FROM public.${table} t ORDER BY to_jsonb(t)::text`,
          )
        ).rows,
      });
    return result;
  };
  const previousHistory = await historySnapshot();
  const businessBefore = await businessSnapshot();
  check(
    businessBefore
      .filter(({ table }) =>
        ["gifts", "gift_variants", "prices", "inventory_balances"].includes(
          table,
        ),
      )
      .every(({ rows }) => rows.length > 0),
    "detail regression starts with real gift, variant, price and stock rows",
  );
  await migrate({ direction: "up" });
  check(
    (
      await client.query("SELECT valid_storefront_theme($1::jsonb) valid", [
        JSON.stringify(detailOnly),
      ])
    ).rows[0].valid === true,
    "SQL accepts new detail templates after upgrade",
  );
  assert.deepEqual(await historySnapshot(), previousHistory);
  check(
    true,
    "0047 upgrade leaves both previous generations of history unchanged",
  );
  await migrate({ direction: "down", confirmVersion: "0047" });
  check(
    (
      await client.query("SELECT valid_storefront_theme($1::jsonb) valid", [
        JSON.stringify(combined),
      ])
    ).rows[0].valid === false,
    "0047 downgrade restores the exact 0046 rejection of detail templates",
  );
  check(
    (
      await client.query("SELECT valid_storefront_theme($1::jsonb) valid", [
        JSON.stringify(presentationCommand.theme),
      ])
    ).rows[0].valid === true,
    "0047 downgrade preserves existing presentation support",
  );
  assert.deepEqual(await historySnapshot(), previousHistory);
  await migrate({ direction: "up", targetVersion: "0047" });

  const bases = [legacy];
  for (const heroLayout of ["IMMERSIVE", "SPLIT"])
    for (const giftLayout of ["GRID", "SHOWCASE"])
      for (const motion of ["STANDARD", "SUBTLE", "NONE"])
        for (const motionSpeed of ["STANDARD", "QUICK"])
          bases.push({
            ...legacy,
            presentation: { heroLayout, giftLayout, motion, motionSpeed },
          });
  const cases = [...bases];
  for (const artist of ["IMMERSIVE", "SPLIT"])
    for (const gift of ["IMAGE_LEFT", "IMAGE_RIGHT"])
      for (const base of bases)
        cases.push({ ...base, detailTemplates: { artist, gift } });
  for (const detailTemplates of [
    null,
    {},
    [],
    "SPLIT",
    { artist: "SPLIT" },
    { gift: "IMAGE_LEFT" },
    { ...templates, artist: null },
    { ...templates, gift: null },
    { ...templates, artist: "CUSTOM" },
    { ...templates, gift: "STACKED" },
    { ...templates, css: "body{}" },
    { ...templates, price: 100 },
  ])
    for (const base of [legacy, presentationCommand.theme])
      cases.push({ ...base, detailTemplates });
  cases.push(
    { ...combined, css: "body{}" },
    { ...combined, schemaVersion: 2 },
    { ...combined, corners: "CUSTOM" },
    { ...combined, presentation: null },
    { ...combined, presentation: { ...presentation, script: "alert(1)" } },
    { ...combined, presentation: { ...presentation, motion: "CUSTOM" } },
  );
  for (const value of cases) {
    const valid = (
      await client.query("SELECT valid_storefront_theme($1::jsonb) valid", [
        JSON.stringify(value),
      ])
    ).rows[0].valid;
    check(
      valid === storefrontThemeSchema.safeParse(value).success,
      "SQL and Zod agree on independent detail and presentation combinations",
    );
  }
  for (const command of [
    saveCommand,
    presentationCommand,
    presentationPublish,
  ]) {
    const replay = await execute(command);
    check(
      replay.outcome === "SUCCESS" && replay.replayed === true,
      "pre-0047 legacy or presentation receipt still replays",
    );
    const expected = previousHistory.find(
      (row) =>
        row.kind === "receipt" &&
        row.value.idempotency_key === command.idempotencyKey,
    )?.value.response;
    assert.deepEqual({ ...replay, replayed: false }, expected);
  }
  for (const command of [saveCommand, presentationCommand])
    check(
      (
        await execute({
          ...command,
          theme: {
            ...command.theme,
            detailTemplates: createDefaultStorefrontDetailTemplates(),
          },
        })
      ).code === "IDEMPOTENCY_CONFLICT",
      "explicit detail defaults cannot reuse either prior-generation key",
    );

  const detailCommand = save(detailOnly, presentationPublished.state.version);
  const detailSaved = await execute(detailCommand);
  check(
    detailSaved.outcome === "SUCCESS",
    "detail-only draft saves without inserting presentation defaults",
  );
  assert.deepEqual(detailSaved.state.draft.theme, detailOnly);
  assert.deepEqual(
    (await publicApp.execute()).theme,
    presentationCommand.theme,
  );
  check(
    (await execute(detailCommand)).replayed === true,
    "detail-only draft retry replays",
  );
  check(
    (
      await execute({
        ...detailCommand,
        theme: {
          ...detailOnly,
          detailTemplates: { ...templates, gift: "IMAGE_LEFT" },
        },
      })
    ).code === "IDEMPOTENCY_CONFLICT",
    "detail layout choice participates in the command hash",
  );
  check(
    (await execute(save(combined, presentationPublished.state.version)))
      .code === "STALE_VERSION",
    "stale detail draft cannot replace the current revision",
  );
  const detailPublish = publish(detailSaved);
  await client.query(
    "CREATE FUNCTION fail_detail_theme_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected detail template failure'; END $$; CREATE TRIGGER fail_detail_theme_test BEFORE INSERT ON storefront_theme_publications FOR EACH ROW EXECUTE FUNCTION fail_detail_theme_test()",
  );
  check(
    (await execute(detailPublish)).outcome === "FAILURE",
    "detail template publication failure is reported",
  );
  assert.deepEqual(
    (await publicApp.execute()).theme,
    presentationCommand.theme,
  );
  assert.deepEqual(
    (await execute({ schemaVersion: 1, action: "READ" })).state.draft,
    detailSaved.state.draft,
  );
  check(
    true,
    "failed detail publication preserves the published theme and complete draft",
  );
  await client.query(
    "DROP TRIGGER fail_detail_theme_test ON storefront_theme_publications; DROP FUNCTION fail_detail_theme_test()",
  );
  const detailPublished = await execute(detailPublish);
  check(
    detailPublished.outcome === "SUCCESS",
    "detail-only template publishes via existing transaction",
  );
  assert.deepEqual((await publicApp.execute()).theme, detailOnly);
  check(
    (await execute(detailPublish)).replayed === true,
    "detail publication retry does not append history",
  );

  const combinedSaved = await execute(
    save(combined, detailPublished.state.version),
  );
  check(
    combinedSaved.outcome === "SUCCESS",
    "combined presentation and detail templates save",
  );
  const combinedPublished = await execute(publish(combinedSaved));
  check(combinedPublished.outcome === "SUCCESS", "combined template publishes");
  assert.deepEqual((await publicApp.execute()).theme, combined);
  let currentVersion = combinedPublished.state.version;
  for (const source of [
    published,
    presentationPublished,
    detailPublished,
    combinedPublished,
    published,
  ]) {
    const result = await restore(
      source.state.published.publicationId,
      currentVersion,
    );
    check(
      result.outcome === "SUCCESS" &&
        result.state.version === currentVersion + 1,
      "restoring each theme generation appends a new version",
    );
    assert.deepEqual(
      result.state.published.theme,
      source.state.published.theme,
    );
    check(
      result.state.published.revisionId !== source.state.published.revisionId,
      "restore preserves the source immutable revision",
    );
    currentVersion = result.state.version;
  }
  const beforeRefusedDown = await historySnapshot();
  let refused = false;
  try {
    await migrate({ direction: "down", confirmVersion: "0047" });
  } catch {
    refused = true;
  }
  check(
    refused &&
      (await client.query("SELECT max(version) v FROM schema_migrations"))
        .rows[0].v === "0047",
    "0047 downgrade refuses new detail history even with legacy current theme",
  );
  assert.deepEqual(await historySnapshot(), beforeRefusedDown);
  const restored = await restore(
    combinedPublished.state.published.publicationId,
    currentVersion,
  );
  check(
    restored.outcome === "SUCCESS",
    "combined template can still be restored after refused downgrade",
  );
  const after = await historySnapshot();
  assert.deepEqual(
    after.filter((row) =>
      previousHistory.some((old) => old.kind === row.kind && old.id === row.id),
    ),
    previousHistory,
  );
  assert.deepEqual(await publicLayout.execute(), priorLayout);
  assert.deepEqual(await businessSnapshot(), businessBefore);
  check(
    true,
    "detail templates leave previous receipts, histories, independent layout and commerce unchanged",
  );
  return restored.state.version;
}
