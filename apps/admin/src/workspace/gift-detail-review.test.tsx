import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { contentReviewResponseSchema } from "@fan-support/contracts";
import { createAdminClient, AdminClientError } from "./client";
import { translator } from "./components";
import {
  GiftDetailReview,
  loadGiftDetailReview,
  sendGiftDetailReview,
} from "./gift-detail-review";
import { readEditorGift } from "./editor-state";

const revisionId = "51000000-0000-4000-8000-000000000001";
const editorId = "51000000-0000-4000-8000-000000000002";
const reviewerId = "51000000-0000-4000-8000-000000000003";
const response = {
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "REVIEW",
  context: {
    schemaVersion: 1,
    target: { kind: "GIFT_DETAILS", revisionId, locale: "ja" },
    subjectId: "51000000-0000-4000-8000-000000000004",
    sequence: 2,
    status: "IN_REVIEW",
    editorId,
    structureEditorId: editorId,
    editedAt: "2026-09-07T10:00:00.000001Z",
    contentHash: "a".repeat(64),
    sourceHash: "b".repeat(64),
    locales: ["ja"],
  },
  content: {
    kind: "GIFT_DETAILS",
    document: {
      schemaVersion: 1,
      id: "51000000-0000-4000-8000-000000000005",
      giftRevisionId: revisionId,
      blocks: [{ id: "description", kind: "PARAGRAPH" }],
    },
    translation: {
      blocks: [
        { blockId: "description", kind: "PARAGRAPH", text: "日本語の礼物詳細" },
      ],
    },
  },
  source: {
    blocks: [
      {
        blockId: "description",
        kind: "PARAGRAPH",
        text: "Actual English gift details",
      },
    ],
  },
};
function clientWith(body: unknown) {
  const transport = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify(body)),
  );
  return {
    client: createAdminClient(
      () => "fixture-csrf",
      () => {},
      transport,
    ),
    transport,
  };
}
it("reads only the assigned detail locale through the existing scoped review route", async () => {
  const { client, transport } = clientWith(response);
  const result = await loadGiftDetailReview(client, revisionId, "ja");
  expect(result?.context.target).toEqual(response.context.target);
  expect(transport).toHaveBeenCalledOnce();
  expect(transport.mock.calls[0]?.[0]).toBe("/api/admin/alias-review-read");
  expect(JSON.parse(String(transport.mock.calls[0]?.[1]?.body))).toEqual({
    schemaVersion: 1,
    target: response.context.target,
  });
});
it("shows selected and English details with an independent approval action without a full authoring snapshot", async () => {
  const { client } = clientWith(response);
  const data = await loadGiftDetailReview(client, revisionId, "ja");
  if (!data) throw new Error("Missing fixture");
  const html = renderToStaticMarkup(
    <GiftDetailReview
      review={data}
      actorId={reviewerId}
      permissions={["content.read", "content.translation.review"]}
      blocked={false}
      t={translator("en")}
      onReview={() => {}}
    />,
  );
  expect(html).toContain("日本語の礼物詳細");
  expect(html).toContain("Actual English gift details");
  expect(approvalButton(html)).not.toContain("disabled");
  expect(html).not.toContain("authoring-read");
});
it("does not expose an enabled approval for either original editor or while unsaved changes exist", async () => {
  const { client } = clientWith(response);
  const data = await loadGiftDetailReview(client, revisionId, "ja");
  if (!data) throw new Error("Missing fixture");
  for (const [actorId, blocked] of [
    [editorId, false],
    [reviewerId, true],
  ] as const) {
    const html = renderToStaticMarkup(
      <GiftDetailReview
        review={data}
        actorId={actorId}
        permissions={["content.translation.review"]}
        blocked={blocked}
        t={translator("en")}
        onReview={() => {}}
      />,
    );
    expect(approvalButton(html)).toContain("disabled");
  }
});
it("rejects wrong-locale evidence and keeps permission failures visible", async () => {
  contentReviewResponseSchema.parse(response);
  await expect(
    loadGiftDetailReview(clientWith(response).client, revisionId, "pt"),
  ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  await expect(
    loadGiftDetailReview(
      clientWith({ schemaVersion: 1, outcome: "FAILURE", code: "FORBIDDEN" })
        .client,
      revisionId,
      "ja",
    ),
  ).rejects.toBeInstanceOf(AdminClientError);
  expect(
    await loadGiftDetailReview(
      clientWith({ schemaVersion: 1, outcome: "FAILURE", code: "NOT_FOUND" })
        .client,
      revisionId,
      "ja",
    ),
  ).toBeNull();
});

function approvalButton(html: string) {
  const button = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/gu)]
    .map(([value]) => value)
    .find((value) => value.includes("Review gift details"));
  expect(button).toBeDefined();
  return button!;
}
it("existing content reviewers can continue without commercial access, but creation and other failures remain strict", async () => {
  const denied = clientWith({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "FORBIDDEN",
  }).client;
  expect(await readEditorGift(denied, editorId, revisionId, "ja")).toBeNull();
  await expect(
    readEditorGift(denied, editorId, null, "ja"),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const expired = clientWith({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "UNAUTHENTICATED",
  }).client;
  await expect(
    readEditorGift(expired, editorId, revisionId, "ja"),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
});
it("approval uses the displayed review version and source hashes without silently reloading unseen evidence", async () => {
  const read = await loadGiftDetailReview(
    clientWith(response).client,
    revisionId,
    "ja",
  );
  if (!read) throw new Error("Missing fixture");
  const { client, transport } = clientWith({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "MUTATION",
    resultId: reviewerId,
    replayed: false,
  });
  await sendGiftDetailReview(client, read, "approve", "REVIEW_DETAILS");
  expect(transport).toHaveBeenCalledOnce();
  expect(transport.mock.calls[0]?.[0]).toBe("/api/admin/alias-review-approve");
  expect(JSON.parse(String(transport.mock.calls[0]?.[1]?.body))).toEqual({
    schemaVersion: 1,
    target: response.context.target,
    expectedVersion: 2,
    expectedContentHash: response.context.contentHash,
    expectedSourceHash: response.context.sourceHash,
    reasonCode: "REVIEW_DETAILS",
  });
});
