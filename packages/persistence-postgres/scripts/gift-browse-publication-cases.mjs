import assert from "node:assert/strict";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import {
  projectPublishedContent,
  selectPublishedGift,
} from "@fan-support/content";

/** Reuses an owned real publication fixture; this helper never seeds or changes business rows. */
export async function verifyGiftBrowsePublicationCases({
  persistence,
  giftId,
  idolId,
  sourceLocale,
}) {
  let checks = 0;
  const equal = (actual, expected, label) => {
    assert.deepEqual(actual, expected, label);
    checks++;
  };
  for (const locale of SUPPORTED_LOCALES) {
    const result =
      await persistence.contentReadTransactionManager.runInContentReadTransaction(
        ({ catalogDirectory }) =>
          catalogDirectory.browseGifts({
            schemaVersion: 1,
            query: {
              schemaVersion: 1,
              locale,
              page: 1,
              pageSize: 48,
              ...(idolId ? { idolId } : {}),
            },
          }),
      );
    equal(result.outcome, "SUCCESS", "published gift browser succeeds");
    const record = result.items.find(
      (item) =>
        (item.schemaVersion === 3
          ? item.context.current.document.ownerId
          : item.source.base.id) === giftId,
    );
    assert.ok(record, "known gift is in the bounded fixture window");
    checks++;
    let view;
    if (record.schemaVersion === 3) {
      const projected = projectPublishedContent(record.context);
      equal(projected.outcome, "SUCCESS", "daily publication proof verifies");
      view = projected.content.view;
    } else {
      const projected = selectPublishedGift(record.selection, record.source);
      equal(projected.success, true, "strict publication proof verifies");
      view = projected.value;
    }
    equal(view.id, giftId, "published identity is retained");
    equal(
      view.localeContext.requestedLocale,
      locale,
      "requested locale is retained",
    );
    if (sourceLocale)
      equal(
        view.localeContext.resolvedLocale,
        sourceLocale,
        "daily source language remains explicit",
      );
    equal("offer" in record, false, "browse result has no monetary offer");
  }
  return {
    schemaVersion: 1,
    result: "PASS",
    checks,
    locales: [...SUPPORTED_LOCALES],
    sourceLocale: sourceLocale ?? null,
  };
}
