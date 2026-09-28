import { expect, test } from "vitest";
import { createAdminClient } from "../workspace/client";
import { informationFixture } from "./fixture";
const subject = await import("./api").catch(() => undefined);
function api(fetcher: typeof fetch) {
  expect(subject?.createInformationPagesApi).toBeTypeOf("function");
  return subject!.createInformationPagesApi(
    createAdminClient(
      () => "csrf",
      () => {},
      fetcher,
    ),
  );
}
const success = (workspace: unknown, replayed = false) =>
  Response.json({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "STATE",
    workspace,
    replayed,
  });
test("read rejects a different page or locale", async () => {
  for (const patch of [{ pageKey: "FAQ" }, { locale: "zh-CN" }]) {
    const client = api(async () =>
      success({ ...informationFixture(), ...patch }),
    );
    await expect(client.read("ABOUT", "en")).rejects.toThrow(
      "INVALID_RESPONSE",
    );
  }
});
test("save verifies receipt identity, retains retry key and rereads authority after replay", async () => {
  const source = informationFixture();
  const drafts = {
    structure: source.draft!.structure,
    fields: source.selected!.fields,
  };
  const keys: string[] = [];
  let wrong = true;
  const client = api(async (url, init) => {
    keys.push(new Headers(init?.headers).get("idempotency-key") ?? "");
    return success(
      { ...source, version: wrong ? 4 : 2 },
      !wrong && String(url).endsWith("save"),
    );
  });
  await expect(client.save(source, drafts)).rejects.toThrow("INVALID_RESPONSE");
  wrong = false;
  const result = await client.save(source, drafts);
  expect(result.version).toBe(2);
  expect(keys[0]).toBe(keys[1]);
  expect(keys).toHaveLength(3);
});
test("review submits displayed hashes and sequence without first reading unseen content", async () => {
  const source = informationFixture();
  const requests: { url: string; body: unknown }[] = [];
  const client = api(async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return success({
      ...source,
      version: 2,
      selected: {
        ...source.selected!,
        review: {
          status: "IN_REVIEW",
          sequence: 2,
          reviewerId: null,
          reviewedAt: null,
        },
      },
    });
  });
  await client.review(source, "submit");
  expect(requests).toHaveLength(1);
  expect(requests[0]!.body).toMatchObject({
    revisionId: source.draft!.revisionId,
    expectedContentHash: source.selected!.contentHash,
    expectedSourceHash: source.draft!.sourceHash,
    expectedReviewSequence: 1,
  });
});

test("save and review reject wrong saved fields or unseen review evidence", async () => {
  const state = informationFixture();
  const draft = {
    structure: state.draft!.structure,
    fields: state.selected!.fields,
  };
  const saved = api(async () =>
    success({
      ...state,
      version: 2,
      selected: {
        ...state.selected!,
        fields: { ...state.selected!.fields, title: "Other" },
      },
    }),
  );
  await expect(saved.save(state, draft)).rejects.toThrow("INVALID_RESPONSE");
  const reviewed = api(async () =>
    success({
      ...state,
      version: 2,
      selected: {
        ...state.selected!,
        contentHash: "b".repeat(64),
        review: {
          status: "IN_REVIEW",
          sequence: 2,
          reviewerId: null,
          reviewedAt: null,
        },
      },
    }),
  );
  await expect(reviewed.review(state, "submit")).rejects.toThrow(
    "INVALID_RESPONSE",
  );
});
test("publish, unpublish and restore reject unrelated publication receipts", async () => {
  const state = informationFixture();
  const invalid = api(async () =>
    success({
      ...state,
      version: 2,
      published: {
        publicationId: "10000000-0000-4000-8000-000000000090",
        pageKey: "ABOUT",
        revisionId: "10000000-0000-4000-8000-000000000091",
        version: 2,
        action: "PUBLISH",
        restoredFromPublicationId: null,
        publishedAt: "2026-09-28T00:00:00Z",
      },
    }),
  );
  await expect(invalid.publish(state)).rejects.toThrow("INVALID_RESPONSE");
  await expect(invalid.unpublish(state)).rejects.toThrow("INVALID_RESPONSE");
  await expect(
    invalid.restore(state, "10000000-0000-4000-8000-000000000092"),
  ).rejects.toThrow("INVALID_RESPONSE");
});
