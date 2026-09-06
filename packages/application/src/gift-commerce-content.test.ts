import { expect, test, vi } from "vitest";
import {
  SUPPORTED_LOCALES,
  contentAuthoringCommandSchema,
  contentAuthoringSnapshotSchema,
  giftCommerceRequestSchema,
  adminPrincipalSchema,
  giftCommerceAccessContextCommandSchema,
  type ContentAuthoringSnapshot,
  type SupportedLocale,
} from "@fan-support/contracts";
import {
  prepareContentAuthoring,
  computeContentAuthoringSnapshotHash,
  prepareGiftDetailDraft,
} from "@fan-support/content";
import { authorizeGiftContent } from "./gift-commerce-content.js";

const id = (n: number) =>
  `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const principal = adminPrincipalSchema.parse({
  schemaVersion: 1,
  actorId: id(1),
  sessionId: id(2),
  authorizedAt: "2026-09-06T20:00:00.000789Z",
  expiresAt: "2026-09-06T21:00:00.123456Z",
});
const authorization = giftCommerceAccessContextCommandSchema.parse({
  schemaVersion: 1,
  sessionTokenDigest: "a".repeat(64),
  csrfTokenDigest: "b".repeat(64),
});
const fields = (locale: string) => ({
  title: `Gift ${locale}`,
  shortDescription: `Summary ${locale}`,
  description: `Description ${locale}`,
  fulfillmentDescription: `Studio prepares ${locale}`,
  variantLabels: [{ giftVariantId: id(3), label: `Standard ${locale}` }],
  seoTitle: `Gift ${locale}`,
  seoDescription: `Description ${locale}`,
});
function create(locales: readonly SupportedLocale[] = SUPPORTED_LOCALES) {
  const command = contentAuthoringCommandSchema.parse({
    schemaVersion: 1,
    action: "CREATE",
    target: { kind: "GIFT", giftId: id(4) },
    expectedVersion: 0,
    reasonCode: "SETUP",
    idempotencyKey: "gift-source-setup",
    content: {
      kind: "GIFT",
      structure: {
        category: "OTHER",
        contents: [{ componentCode: "CARD", quantity: 1, unit: "ITEM" }],
        deliveryEstimate: { minimum: 1, maximum: 2, unit: "DAY" },
        requiresSafetyNotice: false,
        shippingMode: "internal_to_idol",
      },
      media: [],
      translations: locales.map((locale) => ({
        locale,
        origin: "HUMAN",
        fields: fields(locale),
      })),
    },
  });
  if (command.action !== "CREATE") throw new Error("fixture");
  return command;
}
function snapshot(extensions = false): ContentAuthoringSnapshot {
  const command = create(extensions ? ["en", "ja"] : SUPPORTED_LOCALES);
  const plan = prepareContentAuthoring(command, null, {
    actorId: principal.actorId,
    createdAt: principal.authorizedAt,
  });
  const result = contentAuthoringSnapshotSchema.parse({
    schemaVersion: 1,
    target: command.target,
    revisionId: id(5),
    revisionNumber: 1,
    headVersion: 1,
    lifecycle: { status: "DRAFT" },
    createdBy: principal.actorId,
    createdAt: principal.authorizedAt,
    contentHash: "0".repeat(64),
    content: plan.content,
    translationAudits: plan.translationAudits.map((row, i) => ({
      ...row,
      id: id(10 + i),
      reviewId: id(30 + i),
      reviewSequence: 1,
    })),
    extensions: {},
  });
  if (extensions && result.content.kind === "GIFT") {
    const details = prepareGiftDetailDraft(
      {
        schemaVersion: 1,
        document: {
          schemaVersion: 1,
          id: id(80),
          giftRevisionId: result.revisionId,
          blocks: [{ id: "intro", kind: "PARAGRAPH" }],
        },
        translations: ["en", "th"].map((locale, i) => ({
          id: id(81 + i),
          locale,
          origin: "HUMAN",
          blocks: [
            { blockId: "intro", kind: "PARAGRAPH", text: `Detail ${locale}` },
          ],
        })),
        actorId: principal.actorId,
        requestId: id(85),
        reasonCode: "SETUP",
      },
      principal.authorizedAt,
    );
    if (details.outcome !== "SUCCESS") throw new Error("fixture");
    result.extensions.details = details;
    result.content.details = {
      blocks: details.document.blocks,
      translations: details.translations.map((row) => ({
        locale: row.locale,
        origin: row.origin,
        blocks: row.blocks,
      })),
    };
  }
  result.contentHash = computeContentAuthoringSnapshotHash(
    result,
  ) as ContentAuthoringSnapshot["contentHash"];
  return result;
}
function envelope(authoring: unknown) {
  return giftCommerceRequestSchema.parse({
    schemaVersion: 1,
    requestId: id(99),
    sessionToken: "A".repeat(43),
    csrfToken: "E".repeat(43),
    command: {
      schemaVersion: 1,
      action: "SAVE_GIFT_CONTENT",
      expectedBaseVersion: 1,
      giftKind: "WISH",
      reasonCode: "CONTENT_EDITED",
      idempotencyKey: "gift-content-edit",
      authoring,
    },
  });
}
function copy(
  source: ContentAuthoringSnapshot,
  locale: SupportedLocale = "ja",
) {
  return {
    schemaVersion: 1,
    action: "COPY",
    target: source.target,
    sourceRevisionId: source.revisionId,
    expectedVersion: source.headVersion,
    expectedSourceHash: source.contentHash,
    changes: {
      kind: "GIFT",
      translations: [
        {
          locale,
          origin: "HUMAN",
          fields: { ...fields(locale), title: `Updated ${locale}` },
        },
      ],
    },
  };
}
function setup(source = snapshot()) {
  const authorize = vi.fn(async () => ({
    schemaVersion: 1,
    outcome: "SUCCESS",
    principal,
  }));
  const read = vi.fn(async () => ({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "REVISION",
    snapshot: source,
  }));
  return {
    authorize,
    read,
    repositories: {
      contentAuthorization: { authorize },
      contentAuthoring: { read },
    } as never,
  };
}
test("gift CREATE checks content.edit for the actual submitted locales before writing", async () => {
  const command = create(["en", "ja"]);
  const authoring = Object.fromEntries(
    Object.entries(command).filter(
      ([key]) => !["idempotencyKey", "reasonCode"].includes(key),
    ),
  );
  const state = setup();
  await authorizeGiftContent(
    state.repositories,
    envelope(authoring),
    authorization,
    principal,
  );
  expect(state.authorize).toHaveBeenCalledWith(
    expect.objectContaining({
      permission: "content.edit",
      locales: ["en", "ja"],
    }),
  );
  expect(state.read).not.toHaveBeenCalled();
});
test.each(["ja", "en"] as const)(
  "gift COPY derives %s scope from the actual canonical source",
  async (locale) => {
    const source = snapshot(),
      state = setup(source);
    await authorizeGiftContent(
      state.repositories,
      envelope(copy(source, locale)),
      authorization,
      principal,
    );
    expect(state.authorize).toHaveBeenLastCalledWith(
      expect.objectContaining({
        permission: "content.edit",
        locales: locale === "en" ? SUPPORTED_LOCALES : ["ja"],
      }),
    );
  },
);
test("copied or removed multilingual details retain both old and new permission scopes", async () => {
  const source = snapshot(true),
    state = setup(source);
  await authorizeGiftContent(
    state.repositories,
    envelope(copy(source)),
    authorization,
    principal,
  );
  expect(state.authorize).toHaveBeenLastCalledWith(
    expect.objectContaining({ locales: ["en", "th", "ja"] }),
  );
});
test("replay computes current canonical scope before comparing the caller's historic hash", async () => {
  const source = snapshot(),
    state = setup(source);
  await authorizeGiftContent(
    state.repositories,
    envelope({ ...copy(source, "en"), expectedSourceHash: "f".repeat(64) }),
    authorization,
    principal,
  );
  expect(state.authorize).toHaveBeenLastCalledWith(
    expect.objectContaining({ locales: SUPPORTED_LOCALES }),
  );
});
test("a different canonical source or fabricated snapshot hash is rejected", async () => {
  const source = snapshot(),
    state = setup(source);
  source.contentHash = "f".repeat(
    64,
  ) as ContentAuthoringSnapshot["contentHash"];
  await expect(
    authorizeGiftContent(
      state.repositories,
      envelope(copy(source)),
      authorization,
      principal,
    ),
  ).rejects.toMatchObject({ failure: { code: "COMMERCE_UNAVAILABLE" } });
});
test("gift.manage does not replace content.edit and different sessions cannot complete the second authorization", async () => {
  const source = snapshot(),
    state = setup(source);
  state.authorize.mockResolvedValueOnce({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "FORBIDDEN",
  } as never);
  await expect(
    authorizeGiftContent(
      state.repositories,
      envelope(copy(source)),
      authorization,
      principal,
    ),
  ).rejects.toMatchObject({ failure: { code: "FORBIDDEN" } });
  state.authorize.mockResolvedValueOnce({
    schemaVersion: 1,
    outcome: "SUCCESS",
    principal: { ...principal, sessionId: id(8) },
  } as never);
  await expect(
    authorizeGiftContent(
      state.repositories,
      envelope(copy(source)),
      authorization,
      principal,
    ),
  ).rejects.toMatchObject({ failure: { code: "COMMERCE_UNAVAILABLE" } });
});
