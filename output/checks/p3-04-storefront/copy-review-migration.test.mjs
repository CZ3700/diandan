import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { SUPPORTED_LOCALES } from "../../../packages/contracts/dist/index.js";
import { storefrontCopyReviews } from "../../../packages/i18n/dist/storefront/review-manifest.js";

const before = JSON.parse(
  await readFile(
    new globalThis.URL("./copy-review-manifest-before.json", import.meta.url),
  ),
);

test("the derived aggregate preserves the complete pre-migration JSON", () => {
  assert.equal(JSON.stringify(storefrontCopyReviews), JSON.stringify(before));
});

for (const locale of SUPPORTED_LOCALES) {
  test(`${locale} independent review preserves the exact pre-migration JSON`, async () => {
    const { default: review } = await import(
      `../../../packages/i18n/dist/storefront/${locale}.review.js`
    );
    assert.equal(JSON.stringify(review), JSON.stringify(before[locale]));
    assert.equal(storefrontCopyReviews[locale], review);
  });
}
