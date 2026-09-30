import { expect, test } from "vitest";
import { IntlMessageFormat } from "intl-messageformat";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { loadStorefrontCopy } from "./messages.js";

const keys = [
  "wishTitle",
  "wishOnlyFor",
  "wishOpen",
  "wishPaymentPending",
  "wishSupported",
  "wishDelivered",
  "wishUnavailable",
  "wishShowcaseTitle",
  "wishShowcaseIntro",
  "wishShowcaseEmpty",
  "wishShowcaseMore",
  "wishDisplayOptIn",
  "wishDisplayAnonymous",
  "wishDisplayAlias",
  "wishAliasLabel",
  "wishAliasHint",
  "wishAliasInvalid",
  "wishRecordPlanned",
  "wishEdit",
  "wishRecordTitle",
  "wishRecordPrivate",
  "wishRecordPublic",
  "wishRecordSave",
  "wishRecordSaving",
  "wishRecordSaved",
  "wishRecordSaveFailed",
  "wishRecordHidden",
  "wishRecordHide",
  "wishSupportedBy",
  "wishGalleryError",
  "wishOnlyOnce",
  "wishReversed",
  "wishPrivacyWithdrawHint",
];

test.each(SUPPORTED_LOCALES)(
  "wish messages have complete public/privacy states and stable placeholders in %s",
  async (locale) => {
    const copy: Readonly<Record<string, string>> =
      await loadStorefrontCopy(locale);
    for (const key of keys) expect(copy[key], `${locale}:${key}`).toBeTruthy();
    expect(copy["wishSupported"]).not.toBe(copy["wishDelivered"]);
    expect(copy["wishRecordPrivate"]).not.toBe(copy["wishRecordPublic"]);
    expect(
      new IntlMessageFormat(copy["wishOnlyFor"]!, locale).format({
        artist: "Mira",
      }),
    ).toContain("Mira");
    const supported = new IntlMessageFormat(
      copy["wishSupportedBy"]!,
      locale,
    ).format({
      supporter: "Robin",
      artist: "Mira",
      date: "October 1",
    });
    for (const value of ["Robin", "Mira", "October 1"])
      expect(supported).toContain(value);
  },
);
