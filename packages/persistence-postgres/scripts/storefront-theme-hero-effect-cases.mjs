import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createDefaultStorefrontPresentation,
  createDefaultStorefrontTheme,
} from "@fan-support/contracts";

/** Optional deployed hero effects preserve every existing revision and receipt. */
export async function verifyStorefrontHeroEffects({
  client,
  migrate,
  execute,
  publicApp,
  publicLayout,
  priorLayout,
  previousVersion,
  saveCommand,
  check,
}) {
  const legacy = createDefaultStorefrontTheme();
  const presentation = createDefaultStorefrontPresentation();
  const effectTheme = (
    heroEffect,
    motion = "STANDARD",
    motionSpeed = "STANDARD",
  ) => ({
    ...legacy,
    presentation: { ...presentation, motion, motionSpeed, heroEffect },
  });
  const valid = async (theme) =>
    (
      await client.query("SELECT valid_storefront_theme($1::jsonb) valid", [
        JSON.stringify(theme),
      ])
    ).rows[0].valid;
  const version = async () =>
    (await client.query("SELECT max(version) v FROM schema_migrations")).rows[0]
      .v;
  const validator = async () =>
    (
      await client.query(
        "SELECT pg_get_functiondef('valid_storefront_theme(jsonb)'::regprocedure) definition",
      )
    ).rows[0].definition;
  const historySnapshot = async () =>
    (
      await client.query(
        "SELECT 'revision' kind,id,to_jsonb(r) value FROM storefront_theme_revisions r UNION ALL SELECT 'publication',id,to_jsonb(p) FROM storefront_theme_publications p UNION ALL SELECT 'receipt',id,to_jsonb(c) FROM storefront_theme_receipts c ORDER BY kind,id",
      )
    ).rows;
  await migrate({ direction: "up", targetVersion: "0057" });
  const oldValidator = await validator();
  const oldHistory = await historySnapshot();
  const oldPublic = await publicApp.execute();
  const oldReplay = await execute(saveCommand);
  check(
    oldReplay.outcome === "SUCCESS" && oldReplay.replayed,
    "legacy receipt replays before hero effect upgrade",
  );
  check(
    !(await valid(effectTheme("STARLIGHT"))),
    "0057 rejects hero effect before upgrade",
  );

  // Using the current head makes RED fail on the actual missing SQL behavior.
  await migrate({ direction: "up" });
  for (const heroEffect of ["STARLIGHT", "AURORA", "SPOTLIGHT", "PETALS"])
    for (const motion of ["STANDARD", "SUBTLE", "NONE"])
      for (const motionSpeed of ["STANDARD", "QUICK"])
        check(
          await valid(effectTheme(heroEffect, motion, motionSpeed)),
          `${heroEffect}/${motion}/${motionSpeed} passes SQL validation`,
        );
  for (const palette of [
    "BLACK_GOLD",
    "GRAPHITE_PEARL",
    "MIDNIGHT_BLUE",
    "SAKURA_PINK",
    "SKY_BLUE",
    "IVORY_GOLD",
    "PEARL_GRAY",
  ])
    for (const fields of [
      {},
      { presentation },
      { detailTemplates: { artist: "SPLIT", gift: "IMAGE_RIGHT" } },
      {
        presentation,
        detailTemplates: { artist: "SPLIT", gift: "IMAGE_RIGHT" },
      },
    ])
      check(
        await valid({ ...legacy, palette, ...fields }),
        "old theme generations remain valid without effect injection",
      );
  for (const heroEffect of [
    "",
    "starlight",
    "CUSTOM",
    null,
    1,
    true,
    [],
    {},
    "url(evil)",
  ])
    check(
      !(await valid(effectTheme(heroEffect))),
      "SQL rejects invalid hero effect",
    );
  check(
    !(await valid({
      ...effectTheme("STARLIGHT"),
      presentation: { ...effectTheme("STARLIGHT").presentation, css: "body{}" },
    })),
    "SQL rejects extra presentation key with valid effect",
  );
  check(
    !(await valid({ ...legacy, heroEffect: "STARLIGHT" })),
    "SQL rejects hero effect outside presentation",
  );
  check(
    !(await valid({ ...legacy, presentation: { heroEffect: "STARLIGHT" } })),
    "SQL rejects missing required presentation fields",
  );
  assert.deepEqual(await historySnapshot(), oldHistory);
  assert.deepEqual(await publicApp.execute(), oldPublic);
  assert.deepEqual(await execute(saveCommand), oldReplay);
  check(
    true,
    "upgrade preserves old JSON, receipt hashes and published response",
  );

  await migrate({ direction: "down", confirmVersion: "0058" });
  check(
    (await version()) === "0057" && (await validator()) === oldValidator,
    "unused effect migration restores exact prior SQL validator",
  );
  assert.deepEqual(await historySnapshot(), oldHistory);
  await migrate({ direction: "up", targetVersion: "0058" });

  let constraintRejected = false;
  try {
    await client.query(
      "INSERT INTO storefront_theme_revisions(id,theme,actor_id,session_id,request_id,audit_log_id) SELECT $1,$2::jsonb,actor_id,session_id,request_id,audit_log_id FROM storefront_theme_revisions LIMIT 1",
      [randomUUID(), JSON.stringify(effectTheme("CUSTOM"))],
    );
  } catch (error) {
    constraintRejected = error.code === "23514";
  }
  check(
    constraintRejected,
    "revision CHECK rejects an invalid effect even outside the application",
  );

  const refuseDown = async (label) => {
    const before = await historySnapshot();
    const publicBefore = await publicApp.execute();
    let refused = false;
    try {
      await migrate({ direction: "down", confirmVersion: "0058" });
    } catch {
      refused = true;
    }
    check(refused && (await version()) === "0058", label);
    assert.deepEqual(await historySnapshot(), before);
    assert.deepEqual(await publicApp.execute(), publicBefore);
  };
  let currentVersion = previousVersion;
  let effectPublication;
  for (const [index, heroEffect] of [
    "STARLIGHT",
    "AURORA",
    "SPOTLIGHT",
    "PETALS",
  ].entries()) {
    const theme = effectTheme(
      heroEffect,
      ["STANDARD", "SUBTLE", "NONE", "STANDARD"][index],
      index % 2 ? "QUICK" : "STANDARD",
    );
    const command = {
      schemaVersion: 1,
      action: "SAVE_DRAFT",
      expectedVersion: currentVersion,
      idempotencyKey: randomUUID(),
      theme,
    };
    const priorPublic = await publicApp.execute();
    const saved = await execute(command);
    check(saved.outcome === "SUCCESS", `${heroEffect} saves as draft`);
    assert.deepEqual(saved.state.draft.theme, theme);
    assert.deepEqual(await publicApp.execute(), priorPublic);
    const replay = await execute(command);
    check(
      replay.outcome === "SUCCESS" && replay.replayed,
      `${heroEffect} draft is idempotent`,
    );
    assert.deepEqual(replay.state, saved.state);
    if (index === 0)
      await refuseDown("0058 refuses an unpublished explicit STARLIGHT draft");
    const published = await execute({
      schemaVersion: 1,
      action: "PUBLISH",
      expectedVersion: saved.state.version,
      draftRevisionId: saved.state.draft.revisionId,
      idempotencyKey: randomUUID(),
    });
    check(published.outcome === "SUCCESS", `${heroEffect} publishes`);
    assert.deepEqual((await publicApp.execute()).theme, theme);
    check(
      true,
      `${heroEffect} roundtrips with its independent motion and speed`,
    );
    currentVersion = published.state.version;
    if (index === 0)
      effectPublication = (await publicApp.execute()).publicationId;
  }
  const restore = (publicationId) =>
    execute({
      schemaVersion: 1,
      action: "RESTORE",
      publicationId,
      expectedVersion: currentVersion,
      idempotencyKey: randomUUID(),
    });
  const oldRestored = await restore(oldPublic.publicationId);
  check(
    oldRestored.outcome === "SUCCESS",
    "pre-effect publication restores after effect history",
  );
  currentVersion = oldRestored.state.version;
  assert.deepEqual((await publicApp.execute()).theme, oldPublic.theme);
  await refuseDown(
    "0058 still refuses downgrade after restoring a legacy publication",
  );
  const effectRestored = await restore(effectPublication);
  check(
    effectRestored.outcome === "SUCCESS",
    "effect publication restores over legacy public theme",
  );
  assert.deepEqual((await publicApp.execute()).theme, effectTheme("STARLIGHT"));
  assert.deepEqual(await execute(saveCommand), oldReplay);
  assert.deepEqual(await publicLayout.execute(), priorLayout);
  check(
    true,
    "hero effects preserve legacy receipt replay and independent home layout",
  );
  return effectRestored.state.version;
}
