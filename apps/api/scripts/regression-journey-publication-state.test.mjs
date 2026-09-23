import assert from "node:assert/strict";
import { test } from "node:test";
import { assertGiftPublicationAtomicity } from "./regression-journey-publication-state.mjs";

const committed = () => ({
  operations: 1,
  headBindings: 1,
  variants: 1,
  giftRevisions: 1,
  expectedMetadata: 2,
  metadataRevisions: 2,
  priorMediaDrafts: 1,
  unexpectedRevisions: 0,
  revisions: 3,
  manifests: 3,
  contentPublications: 3,
  priceRevisions: 1,
  pricePublications: 1,
  priceReceiptBindings: 1,
  priceHeads: 1,
  priceEvents: 1,
  invalidContentEventGroups: 0,
  invalidPurgeGroups: 0,
});

test("one gift publication binds its actual media count and excludes unrelated poster effects", () => {
  assert.deepEqual(assertGiftPublicationAtomicity(committed()), committed());
});

for (const field of [
  "operations",
  "headBindings",
  "variants",
  "giftRevisions",
  "priceRevisions",
  "pricePublications",
  "priceReceiptBindings",
  "priceHeads",
  "priceEvents",
]) {
  test(`rejects missing or duplicate ${field} after transaction retries`, () => {
    for (const value of [0, 2])
      assert.throws(() =>
        assertGiftPublicationAtomicity({ ...committed(), [field]: value }),
      );
  });
}

test("rejects repeated selected metadata and publication artifacts", () => {
  for (const field of [
    "metadataRevisions",
    "revisions",
    "manifests",
    "contentPublications",
  ])
    assert.throws(() =>
      assertGiftPublicationAtomicity({
        ...committed(),
        [field]: committed()[field] + 1,
      }),
    );
});

test("every publication requires one event and purge job per supported locale", () => {
  for (const field of ["invalidContentEventGroups", "invalidPurgeGroups"])
    assert.throws(() =>
      assertGiftPublicationAtomicity({ ...committed(), [field]: 1 }),
    );
});

test("rejects unreferenced drafts while retaining the exact source processing metadata", () => {
  assert.throws(() =>
    assertGiftPublicationAtomicity({ ...committed(), unexpectedRevisions: 1 }),
  );
});
