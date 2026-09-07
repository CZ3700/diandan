import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareOperationsMaterials } from "./storefront-operations-uat-fixtures.mjs";

test("preparation supplies real bound media but never creates or edits measured targets", async () => {
  const calls = [];
  const fixtures = {
    idol: {
      owner: { kind: "IDOL", idolId: "id" },
      revisionId: "draft",
      publishedRevisionId: "original",
    },
    homepage: { owner: { kind: "HOMEPAGE" }, revisionId: "home-original" },
    media: [{ assetId: "old-image" }],
  };
  const materials = await prepareOperationsMaterials({
    fixtures,
    request: async (route) => {
      calls.push(route);
      if (route.endsWith("context/read"))
        return { markets: [{ market: "GLOBAL", currencies: ["USD"] }] };
      if (route.endsWith("owners/list")) return { totalItems: 0, items: [] };
      return { snapshot: { contentHash: "a".repeat(64) } };
    },
    publish: async (owner, revision) => {
      calls.push([owner.kind, revision]);
      return { publicationId: "baseline-publication" };
    },
    createMediaAsset: async (name, _width, _height, _hue, role) => {
      calls.push(["media", role]);
      return { assetId: name, revisionId: name + "-revision" };
    },
    check: assert.ok,
  });
  assert.deepEqual(calls.filter(Array.isArray)[0], [
    "HOMEPAGE",
    "home-original",
  ]);
  assert.equal(
    calls
      .filter((value) => typeof value === "string")
      .every((value) => value.endsWith("/read") || value.endsWith("/list")),
    true,
  );
  assert.equal(
    calls.filter((value) => Array.isArray(value) && value[0] === "media")
      .length,
    4,
  );
  assert.equal(materials.measuredGift.existsBeforeStart, false);
  assert.equal(materials.measuredGift.inventoryPolicy, "PROCURE_ON_DEMAND");
  assert.equal(materials.measuredGift.type, "PHYSICAL");
  assert.equal(materials.texts.length, 7);
  assert.equal(materials.humanTranslationApproval, false);
  assert.equal(materials.baseline.homepage.revisionId, "home-original");
});
