import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createDefaultStorefrontTheme,
  createDefaultStorefrontPresentation,
} from "@fan-support/contracts";

const LIGHT_PALETTES = ["SAKURA_PINK", "SKY_BLUE", "IVORY_GOLD", "PEARL_GRAY"];

/** L2-16: four light palettes on top of all three theme generations (migration 0056). */
export async function verifyStorefrontLightPalettes({
  client,
  migrate,
  execute,
  publicApp,
  publicLayout,
  priorLayout,
  previousVersion,
  check,
}) {
  const legacy = createDefaultStorefrontTheme();
  const presentation = {
    ...createDefaultStorefrontPresentation(),
    giftLayout: "SHOWCASE",
  };
  const detailTemplates = { artist: "SPLIT", gift: "IMAGE_RIGHT" };
  const generations = (palette) => [
    { ...legacy, palette },
    { ...legacy, palette, presentation },
    { ...legacy, palette, detailTemplates },
    { ...legacy, palette, presentation, detailTemplates },
  ];
  const valid = async (theme) =>
    (
      await client.query("SELECT valid_storefront_theme($1::jsonb) valid", [
        JSON.stringify(theme),
      ])
    ).rows[0].valid;
  const version = async () =>
    (await client.query("SELECT max(version) v FROM schema_migrations")).rows[0]
      .v;
  const historySnapshot = async () =>
    (
      await client.query(
        `SELECT 'revision' kind,id,to_jsonb(r) value FROM storefront_theme_revisions r UNION ALL SELECT 'publication',id,to_jsonb(p) FROM storefront_theme_publications p UNION ALL SELECT 'receipt',id,to_jsonb(c) FROM storefront_theme_receipts c ORDER BY kind,id`,
      )
    ).rows;

  check(
    (await valid({ ...legacy, palette: "SAKURA_PINK" })) === false,
    "0047 rejects light palettes before upgrade",
  );
  const previousHistory = await historySnapshot();
  await migrate({ direction: "up", targetVersion: "0056" });
  let accepted = 0;
  for (const palette of LIGHT_PALETTES)
    for (const theme of generations(palette))
      if (await valid(theme)) accepted++;
  check(
    accepted === LIGHT_PALETTES.length * 4,
    "0056 accepts every light palette in all three theme generations",
  );
  let darkAccepted = 0;
  for (const palette of ["BLACK_GOLD", "GRAPHITE_PEARL", "MIDNIGHT_BLUE"])
    for (const theme of generations(palette))
      if (await valid(theme)) darkAccepted++;
  check(darkAccepted === 12, "0056 still accepts every dark palette");
  let rejected = 0;
  for (const palette of ["sakura_pink", "PEARL_GREY", "LIGHT", "", null])
    if (!(await valid({ ...legacy, palette }))) rejected++;
  if (!(await valid({ ...legacy, palette: "SKY_BLUE", css: "body{}" })))
    rejected++;
  check(
    rejected === 6,
    "0056 rejects unknown palettes and extra fields on light themes",
  );
  assert.deepEqual(await historySnapshot(), previousHistory);
  check(true, "0056 upgrade leaves every theme generation's history unchanged");

  await migrate({ direction: "down", confirmVersion: "0056" });
  check(
    (await version()) === "0055" &&
      (await valid({ ...legacy, palette: "IVORY_GOLD" })) === false &&
      (await valid({
        ...legacy,
        palette: "MIDNIGHT_BLUE",
        presentation,
        detailTemplates,
      })) === true,
    "0056 downgrade without light history restores the exact 0047 validator",
  );
  assert.deepEqual(await historySnapshot(), previousHistory);
  await migrate({ direction: "up", targetVersion: "0056" });

  const save = (theme, expectedVersion) =>
    execute({
      schemaVersion: 1,
      action: "SAVE_DRAFT",
      expectedVersion,
      idempotencyKey: randomUUID(),
      theme,
    });
  const publish = (saved) =>
    execute({
      schemaVersion: 1,
      action: "PUBLISH",
      expectedVersion: saved.state.version,
      draftRevisionId: saved.state.draft.revisionId,
      idempotencyKey: randomUUID(),
    });
  let currentVersion = previousVersion;
  const darkPublication = (await publicApp.execute()).publicationId;
  for (const [index, palette] of LIGHT_PALETTES.entries()) {
    const theme = generations(palette)[index];
    const saved = await save(theme, currentVersion);
    check(saved.outcome === "SUCCESS", `${palette} draft saves`);
    const published = await publish(saved);
    check(published.outcome === "SUCCESS", `${palette} publishes`);
    assert.deepEqual((await publicApp.execute()).theme, theme);
    check(true, `${palette} is the public theme after publishing`);
    currentVersion = published.state.version;
  }
  const beforeRefusedDown = await historySnapshot();
  let refused = false;
  try {
    await migrate({ direction: "down", confirmVersion: "0056" });
  } catch {
    refused = true;
  }
  check(
    refused && (await version()) === "0056",
    "0056 downgrade refuses light palette history",
  );
  assert.deepEqual(await historySnapshot(), beforeRefusedDown);
  const restored = await execute({
    schemaVersion: 1,
    action: "RESTORE",
    publicationId: darkPublication,
    expectedVersion: currentVersion,
    idempotencyKey: randomUUID(),
  });
  check(
    restored.outcome === "SUCCESS" &&
      restored.state.version === currentVersion + 1 &&
      (await publicApp.execute()).theme.palette !== "PEARL_GRAY",
    "a dark publication restores over the light history after a refused downgrade",
  );
  assert.deepEqual(await publicLayout.execute(), priorLayout);
  check(true, "light palettes leave the independent home layout unchanged");
  return restored.state.version;
}
