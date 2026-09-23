import assert from "node:assert/strict";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { matchingLocalHomepage } from "./local-experience-homepage-plan.mjs";

export async function publishLocalHomepage({ client, content, plan, save }) {
  const owner = { kind: "HOMEPAGE" };
  const hasHead = async () =>
    (await client.query("SELECT 1 FROM homepage_publication_heads")).rowCount >
    0;
  if (await hasHead()) return { done: true, outcome: "PRESERVED" };
  if (!plan.revisionId) {
    const existing = (
      await client.query(
        "SELECT id,revision FROM homepage_revisions ORDER BY revision",
      )
    ).rows;
    const candidates = existing.filter(
      (row) => !plan.retiredRevisionIds?.includes(row.id),
    );
    for (const row of candidates) {
      const read = await content.request(
        "/api/v1/admin/content-authoring/read",
        { target: owner, revisionId: row.id },
      );
      if (matchingLocalHomepage(read.snapshot.content, plan.content)) {
        plan.revisionId = row.id;
        break;
      }
    }
    if (candidates.length && !plan.revisionId)
      throw new Error(
        "Existing homepage draft was preserved; bootstrap content differs",
      );
    plan.revisionId ??= (
      await content.write("/api/v1/admin/content-authoring/create", {
        target: owner,
        content: plan.content,
        expectedVersion: Number(existing.at(-1)?.revision ?? 0),
      })
    ).resultId;
    await save();
  }
  const revisionId = plan.revisionId;
  const snapshot = (
    await content.request("/api/v1/admin/content-authoring/read", {
      target: owner,
      revisionId,
    })
  ).snapshot;
  if (!matchingLocalHomepage(snapshot.content, plan.content))
    throw new Error(
      "Existing homepage was preserved; bootstrap revision changed",
    );
  for (const locale of SUPPORTED_LOCALES) {
    if (await hasHead()) return { done: true, outcome: "PRESERVED" };
    const target = { owner, revisionId, locale };
    let read = await content.request("/api/v1/admin/content-review/read", {
      target,
    });
    const writeReview = async (action, actor) =>
      content.write(
        "/api/v1/admin/content-review/" + action,
        {
          target,
          expectedVersion: read.context.audit.reviewSequence,
          expectedContentHash: read.context.audit.sourceHash,
          expectedSourceHash: read.context.currentEnglishSourceHash,
        },
        actor,
      );
    if (read.context.audit.review.status === "DRAFT") {
      await writeReview("submit", "manager");
      read = await content.request("/api/v1/admin/content-review/read", {
        target,
      });
    }
    if (read.context.audit.review.status === "IN_REVIEW")
      await writeReview("approve", "reviewer");
    else if (read.context.audit.review.status !== "APPROVED")
      throw new Error(
        "Homepage bootstrap requires explicit review of changed state",
      );
  }
  if (await hasHead()) return { done: true, outcome: "PRESERVED" };
  const target = { owner, revisionId };
  const preflight = await content.request(
    "/api/v1/admin/content/publication/preflight",
    { target, action: "PUBLISH" },
    { actor: "manager" },
  );
  if (preflight.headVersion !== 0) return { done: true, outcome: "PRESERVED" };
  assert.ok(
    preflight.ready,
    "Local homepage must satisfy the existing publication gate: " +
      preflight.issues?.map(({ code }) => code).join(","),
  );
  const validated =
    snapshot.lifecycle.status === "DRAFT"
      ? await content.write(
          "/api/v1/admin/content/publication/validate",
          {
            target,
            expectedVersion: 0,
            expectedContentHash: preflight.contentHash,
          },
          "manager",
        )
      : preflight;
  assert.equal(validated.headVersion, 0);
  // A concurrent publication makes the normal CAS fail rather than replacing the new homepage.
  await content.write(
    "/api/v1/admin/content/publication/publish",
    { target, expectedVersion: 0, expectedContentHash: validated.contentHash },
    "manager",
  );
  return { done: true, outcome: "CREATED" };
}
