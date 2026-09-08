import { expect, test, vi } from "vitest";
import { managementCenterClaimSchema } from "@fan-support/contracts";
import { loadDailyHomepageTemplate } from "./daily-publication-template.js";

const id = (value: number) =>
  `d2000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const at = "2026-09-08T00:00:00Z";
const claim = managementCenterClaimSchema.parse({
  schemaVersion: 1,
  actorId: id(1),
  sessionId: id(2),
  requestId: id(3),
  operation: {
    operationId: id(4),
    version: 3,
    kind: "REPLACE_POSTER",
    sourceLocale: "zh-CN",
    status: "PROCESSING",
    targetId: null,
    updatedAt: at,
    result: null,
    failure: null,
  },
  intent: {
    kind: "REPLACE_POSTER",
    sourceLocale: "zh-CN",
    expectedVersion: 1,
    image: { uploadId: id(5) },
  },
  intentHash: "a".repeat(64),
  authorizedUntil: "2026-09-08T01:00:00Z",
  leaseTokenDigest: "b".repeat(64),
  leaseExpiresAt: "2026-09-08T00:01:00Z",
  checkpoint: {
    sourceAssetId: null,
    jobs: [],
    preparedMedia: null,
    retryRequested: false,
  },
});

function databaseRows() {
  const base = {
    homepage_revision_id: id(10),
    idol_id: null,
    gift_id: null,
    policy_key: null,
    desktop_media_asset_id: null,
    desktop_media_metadata_revision_id: null,
    mobile_media_asset_id: null,
    mobile_media_metadata_revision_id: null,
  };
  // homepage_slots has no schema_version column; these are its actual SQL shapes.
  return [
    {
      ...base,
      slot_key: "hero",
      kind: "HERO_IDOL",
      idol_id: id(20),
      desktop_media_asset_id: id(30),
      desktop_media_metadata_revision_id: id(31),
      mobile_media_asset_id: id(32),
      mobile_media_metadata_revision_id: id(33),
      sort_order: 0,
    },
    {
      ...base,
      slot_key: "artist",
      kind: "FEATURED_IDOL",
      idol_id: id(20),
      sort_order: 1,
    },
    {
      ...base,
      slot_key: "gift",
      kind: "FEATURED_GIFT",
      gift_id: id(40),
      sort_order: 2,
    },
    {
      ...base,
      slot_key: "terms",
      kind: "POLICY_LINK",
      policy_key: "terms",
      sort_order: 3,
    },
  ];
}

function clientFor(slots: Record<string, unknown>[]) {
  return {
    release: vi.fn(),
    query: async (text: string) => {
      if (text.includes("FROM public.homepage_revisions"))
        return { rows: [{ id: id(10), document: null }] };
      if (text.includes("FROM public.homepage_revision_translations"))
        return {
          rows: [
            {
              value: {
                id: id(11),
                hero_title: "真实首页标题",
                hero_subtitle: "真实首页简介",
                cta_label: "查看艺人",
                announcement: null,
                seo_title: "首页",
                seo_description: "原有首页内容",
              },
            },
          ],
        };
      if (text.includes("FROM public.homepage_slot_translations"))
        return {
          rows: slots.map((slot) => ({
            slot_key: slot["slot_key"],
            label: `入口 ${String(slot["slot_key"])}`,
          })),
        };
      if (text.includes("FROM public.homepage_slots"))
        return { rows: slots.map((value) => ({ value })) };
      throw new Error("Unexpected template query");
    },
  };
}

test("first poster replacement decodes all legacy SQL slot kinds without a nonexistent version column", async () => {
  const template = await loadDailyHomepageTemplate(
    clientFor(databaseRows()),
    claim,
    id(10),
  );
  expect(template.locale).toBe("zh-CN");
  expect(template.fields.heroTitle).toBe("真实首页标题");
  expect(template.fields).not.toHaveProperty("announcement");
  expect(template.slots).toEqual([
    {
      schemaVersion: 1,
      homepageRevisionId: id(10),
      slotKey: "hero",
      kind: "HERO_IDOL",
      idolId: id(20),
      desktopMediaAssetId: id(30),
      desktopMediaMetadataRevisionId: id(31),
      mobileMediaAssetId: id(32),
      mobileMediaMetadataRevisionId: id(33),
      sortOrder: 0,
    },
    {
      schemaVersion: 1,
      homepageRevisionId: id(10),
      slotKey: "artist",
      kind: "FEATURED_IDOL",
      idolId: id(20),
      sortOrder: 1,
    },
    {
      schemaVersion: 1,
      homepageRevisionId: id(10),
      slotKey: "gift",
      kind: "FEATURED_GIFT",
      giftId: id(40),
      sortOrder: 2,
    },
    {
      schemaVersion: 1,
      homepageRevisionId: id(10),
      slotKey: "terms",
      kind: "POLICY_LINK",
      policyKey: "terms",
      sortOrder: 3,
    },
  ]);
});

test("legacy slot adaptation retains strict asset and kind validation", async () => {
  const slots = databaseRows();
  slots[0]!["mobile_media_asset_id"] = slots[0]!["desktop_media_asset_id"];
  await expect(
    loadDailyHomepageTemplate(clientFor(slots), claim, id(10)),
  ).rejects.toThrow();
});
