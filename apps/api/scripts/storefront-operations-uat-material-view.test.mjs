import assert from "node:assert/strict";
import { test } from "node:test";
import { operationsMaterials } from "./storefront-operations-uat-materials.mjs";
import { operationsMaterialSections } from "./storefront-operations-uat-material-view.mjs";

test("operator materials expose three useful named groups without changing audit/source data", () => {
  const materials = {
    ...operationsMaterials(),
    baseline: {
      idol: {
        label: "Luna Mira",
        handle: "luna-mira",
        contentHash: "INTERNAL_HASH",
        revisionId: "INTERNAL_REVISION",
      },
    },
    replacementMedia: Object.fromEntries(
      ["HERO_DESKTOP", "HERO_MOBILE", "PORTRAIT", "GIFT_PRIMARY"].map(
        (role) => [
          role,
          {
            label: "UAT " + role,
            assetId: "INTERNAL_ASSET",
            revisionId: "INTERNAL_REVISION",
          },
        ],
      ),
    ),
    measuredGift: {
      handle: "uat-gift-unique",
      sku: "UAT-UNIQUE",
      type: "PHYSICAL",
      category: "OTHER",
      inventoryPolicy: "PROCURE_ON_DEMAND",
      eligibleIdolLabel: "Luna Mira",
      contents: [{ componentCode: "ITEM", quantity: 1, unit: "ITEM" }],
      deliveryEstimate: { minimum: 1, maximum: 7, unit: "DAY" },
      market: "GLOBAL",
      currency: "USD",
      amountInUi: "10.00",
    },
  };
  const before = JSON.stringify(materials);
  const sections = operationsMaterialSections(materials);
  assert.deepEqual(
    sections.map(({ title }) => title),
    ["替换素材", "艺人英文", "礼物英文与规格／价格"],
  );
  assert.equal(sections[0].rows.length, 4);
  assert.ok(
    sections[1].rows.some(
      (row) =>
        row.label === "简介" &&
        row.value === materials.texts[0].idol.fields.shortBio,
    ),
  );
  assert.ok(
    sections[2].rows.some(
      (row) => row.label === "礼物类型" && row.value === "实体礼物",
    ),
  );
  assert.ok(
    sections[2].rows.some(
      (row) => row.label === "金额（USD）" && row.value === "10.00",
    ),
  );
  assert.ok(
    sections[2].rows.some(
      (row) =>
        row.label === "规格名称（英文）" &&
        row.value === materials.texts[0].variantLabel,
    ),
  );
  assert.doesNotMatch(
    JSON.stringify(sections),
    /INTERNAL_|schemaVersion|texts\.0|contentHash/u,
  );
  assert.equal(JSON.stringify(materials), before);
  assert.throws(
    () => operationsMaterialSections({ ...materials, texts: [] }),
    /PREPARED_ENGLISH_REQUIRED/u,
  );
});
