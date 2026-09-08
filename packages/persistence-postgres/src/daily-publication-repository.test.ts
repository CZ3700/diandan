import { beforeEach, expect, test, vi } from "vitest";
import type * as DailyData from "./daily-publication-data.js";
import type * as DailyTemplate from "./daily-publication-template.js";
import {
  dailyPublicationDocumentSchema,
  managementCenterClaimSchema,
} from "@fan-support/contracts";
const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  document: vi.fn(),
  template: vi.fn(),
  copy: vi.fn(),
}));
vi.mock("./daily-publication-data.js", async (importOriginal) => ({
  ...(await importOriginal<typeof DailyData>()),
  loadDailyClaim: mocks.claim,
  insertDailyDocument: mocks.document,
}));
vi.mock("./daily-publication-template.js", async (importOriginal) => ({
  ...(await importOriginal<typeof DailyTemplate>()),
  loadDailyHomepageTemplate: mocks.template,
  copyDailyMetadata: mocks.copy,
}));
import { createDailyPublicationRepository } from "./daily-publication-repository.js";
const id = "d1000000-0000-4000-8000-000000000001",
  at = "2026-09-08T00:00:00Z";
beforeEach(() => vi.resetAllMocks());
function publicationClaim(
  inventory: unknown = { policy: "PROCURE_ON_DEMAND" },
) {
  const prepared = {
    sourceAssetId: id,
    assets: [
      {
        role: "GIFT_PRIMARY",
        assetId: id,
        metadataRevisionId: id,
        processingJobId: id,
      },
    ],
  };
  return managementCenterClaimSchema.parse({
    schemaVersion: 1,
    actorId: id,
    sessionId: id,
    requestId: id,
    operation: {
      operationId: id,
      version: 3,
      kind: "SAVE_GIFT",
      sourceLocale: "zh-CN",
      status: "PROCESSING",
      targetId: id,
      updatedAt: at,
      result: null,
      failure: null,
    },
    intent: {
      kind: "SAVE_GIFT",
      sourceLocale: "zh-CN",
      id,
      expectedVersion: 7,
      name: "礼物",
      description: "原文",
      image: { uploadId: id },
      giftKind: "WISH",
      category: "OTHER",
      price: { market: "TEST", currency: "USD", amountMinor: 1234 },
      inventory,
      eligibility: { rule: "ALL_ACTIVE_ARTISTS" },
    },
    intentHash: "a".repeat(64),
    authorizedUntil: "2026-09-08T01:00:00Z",
    leaseTokenDigest: "b".repeat(64),
    leaseExpiresAt: "2026-09-08T00:01:00Z",
    checkpoint: {
      sourceAssetId: id,
      jobs: [{ role: "GIFT_PRIMARY", metadataRevisionId: id, jobId: id }],
      preparedMedia: prepared,
      retryRequested: false,
    },
  });
}
test("final publication rechecks an inventory item created after submission before changing variant policy", async () => {
  const claim = publicationClaim();
  mocks.claim.mockResolvedValue(claim);
  const statements: string[] = [];
  const client = {
    release: vi.fn(),
    query: async (text: string) => {
      statements.push(text);
      if (/^(?:SAVEPOINT|ROLLBACK TO SAVEPOINT|RELEASE SAVEPOINT)/u.test(text))
        return { rows: [] };
      if (text.startsWith("SELECT * FROM public.gifts"))
        return {
          rows: [
            {
              id,
              version: 7,
              status: "active",
              published_revision_id: id,
              handle: "test-gift",
            },
          ],
        };
      if (text.includes("publication_utc")) return { rows: [{ at }] };
      if (text.includes("max(revision)")) return { rows: [{ revision: 2 }] };
      if (text.includes("FROM public.gift_variants v"))
        return {
          rows: [
            {
              id,
              sku: "TEST-GIFT",
              status: "active",
              inventory_policy: "TRACKED",
              rule: "ALL_ACTIVE_ARTISTS",
            },
          ],
        };
      if (text.includes("FROM public.inventory_items"))
        return { rows: [{ policy: "TRACKED" }] };
      throw new Error("No downstream mutation expected");
    },
  };
  const scope = {
    markRollbackOnly: vi.fn(),
    trackOperation: async <T>(work: () => Promise<T>) => work(),
  };
  const repository = createDailyPublicationRepository(
    client,
    scope,
    "https://media.example.invalid/",
  );
  await expect(
    repository.publish({
      schemaVersion: 1,
      operationId: id,
      leaseTokenDigest: claim.leaseTokenDigest,
      preparedMedia: claim.checkpoint.preparedMedia,
    }),
  ).resolves.toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "INVENTORY_POLICY_LOCKED",
  });
  expect(
    statements.findIndex(
      (text) =>
        text.includes("FROM public.gift_variants v") &&
        text.includes("FOR UPDATE OF v"),
    ),
  ).toBeLessThan(
    statements.findIndex((text) =>
      text.includes("FROM public.inventory_items"),
    ),
  );
  expect(
    statements.some((text) => text.startsWith("UPDATE public.gift_variants")),
  ).toBe(false);
  expect(mocks.document).not.toHaveBeenCalled();
  expect(statements).toContain("ROLLBACK TO SAVEPOINT resource_management_1");
});

test("zero tracked stock still requires the real location to remain active at final publication", async () => {
  const claim = publicationClaim({
    policy: "TRACKED",
    locationId: id,
    quantity: 0,
  });
  mocks.claim.mockResolvedValue(claim);
  const statements: string[] = [];
  const client = {
    release: vi.fn(),
    query: async (text: string) => {
      statements.push(text);
      if (/^(?:SAVEPOINT|ROLLBACK TO SAVEPOINT|RELEASE SAVEPOINT)/u.test(text))
        return { rows: [] };
      if (text.includes("FROM public.inventory_locations")) return { rows: [] };
      throw new Error("No content preparation or downstream mutation expected");
    },
  };
  const scope = {
    markRollbackOnly: vi.fn(),
    trackOperation: async <T>(work: () => Promise<T>) => work(),
  };
  await expect(
    createDailyPublicationRepository(
      client,
      scope,
      "https://media.example.invalid/",
    ).publish({
      schemaVersion: 1,
      operationId: id,
      leaseTokenDigest: claim.leaseTokenDigest,
      preparedMedia: claim.checkpoint.preparedMedia,
    }),
  ).resolves.toEqual({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "NOT_FOUND",
  });
  expect(
    statements.some(
      (text) =>
        text.includes("FROM public.inventory_locations") &&
        text.includes("status='ACTIVE' FOR SHARE"),
    ),
  ).toBe(true);
  expect(statements).toContain("ROLLBACK TO SAVEPOINT resource_management_1");
});

test("restoring poster history preserves current copy, source locale, hero target and recommendation slots", async () => {
  const uuid = (n: number) =>
    `d3000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const template = (historical: boolean) => {
    const revisionId = uuid(historical ? 10 : 20);
    const prefix = historical ? "历史" : "当前";
    const document = dailyPublicationDocumentSchema.parse({
      schemaVersion: 3,
      kind: "HOMEPAGE",
      ownerId: revisionId,
      revisionId,
      revisionNumber: historical ? 1 : 5,
      createdBy: id,
      createdAt: at,
      source: {
        id: uuid(historical ? 11 : 21),
        locale: historical ? "en" : "zh-CN",
        sourceHash: "a".repeat(64),
        editorId: id,
        editedAt: at,
        fields: {
          heroTitle: `${prefix}标题`,
          heroSubtitle: `${prefix}简介`,
          ctaLabel: `${prefix}按钮`,
          seoTitle: `${prefix}搜索标题`,
          seoDescription: `${prefix}搜索描述`,
          slotLabels: [
            {
              slotKey: historical ? "old-hero" : "current-hero",
              label: `${prefix}主视觉`,
            },
            { slotKey: "gift", label: `${prefix}推荐` },
          ],
        },
      },
      slots: [
        {
          schemaVersion: 1,
          homepageRevisionId: revisionId,
          slotKey: historical ? "old-hero" : "current-hero",
          kind: "HERO_IDOL",
          idolId: uuid(historical ? 12 : 22),
          desktopMediaAssetId: uuid(historical ? 13 : 23),
          desktopMediaMetadataRevisionId: uuid(historical ? 14 : 24),
          mobileMediaAssetId: uuid(historical ? 15 : 25),
          mobileMediaMetadataRevisionId: uuid(historical ? 16 : 26),
          sortOrder: 0,
        },
        {
          schemaVersion: 1,
          homepageRevisionId: revisionId,
          slotKey: "gift",
          kind: "FEATURED_GIFT",
          giftId: uuid(historical ? 17 : 27),
          sortOrder: 1,
        },
      ],
    });
    if (document.kind !== "HOMEPAGE")
      throw new Error("Homepage fixture required");
    return {
      locale: document.source.locale,
      fields: document.source.fields,
      slots: document.slots,
    };
  };
  const current = template(false),
    historical = template(true);
  const existing = publicationClaim();
  const claim = managementCenterClaimSchema.parse({
    ...existing,
    operation: {
      ...existing.operation,
      kind: "RESTORE_POSTER",
      targetId: null,
    },
    intent: {
      kind: "RESTORE_POSTER",
      sourceLocale: "zh-CN",
      expectedVersion: 5,
      sourceRevisionId: uuid(10),
    },
    checkpoint: {
      sourceAssetId: null,
      jobs: [],
      preparedMedia: null,
      retryRequested: false,
    },
  });
  mocks.claim.mockResolvedValue(claim);
  mocks.template.mockImplementation(async (_client, _claim, revisionId) =>
    revisionId === uuid(20) ? current : historical,
  );
  mocks.copy.mockImplementation(
    async (_client, _claim, _assetId, metadataId) => metadataId,
  );
  // Stop at the document boundary: this test inspects preparation without fabricating committed publication proof.
  mocks.document.mockRejectedValue(new Error("Stop after prepared document"));
  const client = {
    release: vi.fn(),
    query: async (text: string) => {
      if (
        /^(?:SAVEPOINT|ROLLBACK TO SAVEPOINT|RELEASE SAVEPOINT)/u.test(text) ||
        text.includes("pg_advisory_xact_lock")
      )
        return { rows: [] };
      if (text.includes("FROM public.homepage_publication_heads"))
        return { rows: [{ homepage_revision_id: uuid(20), version: 5 }] };
      if (text.includes("max(revision)"))
        return { rows: [{ revision: 6, at }] };
      throw new Error("No publication writes expected");
    },
  };
  const scope = {
    markRollbackOnly: vi.fn(),
    trackOperation: async <T>(work: () => Promise<T>) => work(),
  };
  await expect(
    createDailyPublicationRepository(
      client,
      scope,
      "https://media.example.invalid/",
    ).publish({
      schemaVersion: 1,
      operationId: id,
      leaseTokenDigest: claim.leaseTokenDigest,
      preparedMedia: null,
    }),
  ).rejects.toThrow();
  expect(mocks.document).toHaveBeenCalledOnce();
  const document = dailyPublicationDocumentSchema.parse(
    mocks.document.mock.calls[0]![2],
  );
  expect(document.source.locale).toBe(current.locale);
  expect(document.source.fields).toEqual(current.fields);
  expect(document).toMatchObject({
    kind: "HOMEPAGE",
    slots: [
      {
        slotKey: "current-hero",
        idolId: uuid(22),
        desktopMediaAssetId: uuid(13),
        desktopMediaMetadataRevisionId: uuid(14),
        mobileMediaAssetId: uuid(15),
        mobileMediaMetadataRevisionId: uuid(16),
      },
      { slotKey: "gift", giftId: uuid(27) },
    ],
  });
  expect(mocks.template.mock.calls.map((call) => call[2])).toEqual([
    uuid(20),
    uuid(10),
  ]);
});
