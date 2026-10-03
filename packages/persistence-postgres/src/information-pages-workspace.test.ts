import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { SUPPORTED_LOCALES, type AdminPrincipal } from "@fan-support/contracts";
import type { TransactionClient } from "./transaction-runner.js";
import { informationWorkspace } from "./information-pages-workspace.js";
import { informationPageHash } from "./information-pages-data.js";
const sourceActor = randomUUID(),
  translator = randomUUID(),
  id = randomUUID(),
  revisionId = randomUUID(),
  priorId = randomUUID(),
  sourceId = randomUUID();
const at = "2026-09-29T01:00:00.000Z";
const structure = { sectionIds: [id], contactEmail: null };
const english = {
  title: "New English",
  summary: "",
  sections: [{ id, heading: "", body: "New source" }],
};
const previous = { ...english, title: "Original English" };
const sourceHash = informationPageHash({
  pageKey: "ABOUT",
  structure,
  englishFields: english,
});
const oldHash = informationPageHash({
  pageKey: "ABOUT",
  structure,
  englishFields: previous,
});
const principal: AdminPrincipal = {
  schemaVersion: 1,
  actorId: sourceActor,
  sessionId: randomUUID(),
  authorizedAt: at,
  expiresAt: "2030-01-01T00:00:00.000Z",
};
const access = {
  readLocales: [...SUPPORTED_LOCALES],
  editLocales: [...SUPPORTED_LOCALES],
  reviewLocales: [...SUPPORTED_LOCALES],
  canPublish: true,
  canPreview: true,
};
function fixture(stale: boolean): TransactionClient {
  const row = (locale: string) => ({
    id: randomUUID(),
    locale,
    ...(locale === "en" ? english : { ...english, title: "Translated" }),
    content_hash: informationPageHash(
      locale === "en" ? english : { ...english, title: "Translated" },
    ),
    translated_from_source_hash:
      stale && locale === "vi" ? oldHash : sourceHash,
    editor_id: locale === "en" ? sourceActor : translator,
    edited_at: at,
    review_status: "IN_REVIEW",
    review_sequence: 2,
    review_actor_id: translator,
    review_created_at: at,
    reviewed_content_hash: informationPageHash(english),
    reviewed_source_hash: sourceHash,
  });
  return {
    release() {},
    async query(sql, values) {
      if (sql.includes("information_page_heads"))
        return {
          rows: [
            {
              draft_revision_id: revisionId,
              published_publication_id: null,
              version: 8,
            },
          ],
        };
      if (sql.includes("source_hash=$2")) return { rows: [{ ...previous }] };
      if (sql.includes("FROM public.information_page_revisions"))
        return {
          rows: [
            {
              id: values?.[0],
              page_key: "ABOUT",
              structure,
              source_hash: sourceHash,
              source_revision_id:
                values?.[0] === revisionId ? priorId : sourceId,
              created_at: at,
            },
          ],
        };
      if (sql.includes("FROM public.information_page_revision_translations"))
        return { rows: SUPPORTED_LOCALES.map(row) };
      throw new Error("Unexpected query");
    },
  };
}
test("a later translated save preserves another stale locale actual source diff", async () => {
  const workspace = await informationWorkspace(
    fixture(true),
    "ABOUT",
    "vi",
    access,
    principal,
  );
  expect(workspace.previousSource).toEqual(previous);
  expect(workspace.changedPaths).toEqual(["title"]);
  expect(workspace.preview).toBeNull();
});
test("the English structure author cannot approve another editor translation", async () => {
  const workspace = await informationWorkspace(
    fixture(false),
    "ABOUT",
    "vi",
    access,
    principal,
  );
  expect(workspace.capabilities.canApprove).toBe(false);
});
