import { Client } from "pg";
import { loadDailyPublicationContext } from "../../../packages/persistence-postgres/dist/daily-publication-read.js";
import { projectPublishedGiftCommerce } from "../../../packages/content/dist/index.js";

function issues(error) {
  if (error?.name !== "ZodError" || !Array.isArray(error.issues)) return [];
  const found = [];
  function visit(values) {
    for (const issue of values) {
      if (found.length >= 64) return;
      found.push({
        code: /^[a-z_]{1,80}$/u.test(String(issue.code))
          ? issue.code
          : "UNKNOWN",
        path: (Array.isArray(issue.path) ? issue.path : []).filter(
          (part) =>
            typeof part === "number" || /^[A-Za-z_]{1,80}$/u.test(String(part)),
        ),
      });
      if (Array.isArray(issue.errors))
        for (const branch of issue.errors)
          if (Array.isArray(branch)) visit(branch);
    }
  }
  visit(error.issues);
  return found;
}

/** Read the actual daily boundary before the resource adapter normalizes errors. */
export async function diagnoseCartDailyLoader({
  database,
  gift,
  publicMediaBaseUrl,
}) {
  const client = new Client(database);
  const report = { schemaVersion: 1 };
  let stage = "CONNECT";
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    stage = "CURRENT_GIFT_HEAD";
    const rows = (
      await client.query(
        `SELECT to_jsonb(h.*) head,to_jsonb(p.*) publication FROM public.gift_publication_heads h
       JOIN public.content_publications p ON p.id=h.publication_id AND p.gift_id=h.gift_id AND p.gift_revision_id=h.gift_revision_id
       WHERE h.gift_id=$1`,
        [gift.giftId],
      )
    ).rows;
    report.headCount = rows.length;
    if (rows.length !== 1) return { ...report, outcome: "NO_UNIQUE_HEAD" };
    report.proofVersion = Number(rows[0].publication.proof_version);
    stage = "DAILY_LOADER";
    const context = await loadDailyPublicationContext(
      client,
      { kind: "GIFT", giftId: gift.giftId },
      "en",
      rows[0].publication,
      rows[0].head,
      publicMediaBaseUrl,
    );
    report.outcome = context.outcome;
    if (context.outcome === "FAILURE") report.code = context.code;
    else {
      report.contextVersion = context.context.schemaVersion;
      stage = "GIFT_CLASSIFICATION_PROJECTION";
      const projected = projectPublishedGiftCommerce({
        ...context,
        profileVersion: 3,
        profile: null,
      });
      report.giftProjection = projected.outcome;
      if (projected.outcome === "FAILURE") report.giftCode = projected.code;
    }
    return report;
  } catch (error) {
    return {
      ...report,
      outcome: "THREW",
      stage,
      code:
        typeof error?.code === "string" && /^[A-Z0-9_]{1,80}$/u.test(error.code)
          ? error.code
          : null,
      validationIssues: issues(error),
    };
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}
