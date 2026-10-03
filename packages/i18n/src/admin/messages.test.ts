import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { IntlMessageFormat } from "intl-messageformat";
import {
  adminMessages,
  adminMessage,
  adminMessageReviews,
  assertAdminMessagesPublishable,
} from "./messages.js";

describe("admin message catalog", () => {
  it("binds review manifests to the exact current source and translation bytes", () => {
    const hash = (value: unknown) =>
      createHash("sha256").update(JSON.stringify(value)).digest("hex");
    for (const locale of SUPPORTED_LOCALES) {
      expect(adminMessageReviews[locale].sourceHash).toBe(
        hash(adminMessages.en),
      );
      expect(adminMessageReviews[locale].translationHash).toBe(
        hash(adminMessages[locale]),
      );
    }
  });
  it("compiles exactly the same semantic keys and ICU argument/branch structure in seven languages", () => {
    const keys = Object.keys(adminMessages.en).sort();
    const signature = (value: unknown): unknown =>
      Array.isArray(value)
        ? value
            .filter((item) => (item as { type: number }).type !== 0)
            .map(signature)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value)
                .filter(([key]) => key !== "location")
                .map(([key, item]) => [key, signature(item)]),
            )
          : value;
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(adminMessages[locale]).sort()).toEqual(keys);
      for (const key of keys as (keyof typeof adminMessages.en)[]) {
        expect(
          signature(
            new IntlMessageFormat(adminMessages[locale][key], locale).getAst(),
          ),
        ).toEqual(
          signature(
            new IntlMessageFormat(adminMessages.en[key], "en").getAst(),
          ),
        );
        expect(adminMessage(locale, key, { count: 2 })).not.toContain("{count");
      }
    }
  });
  it("records the owner's approval at an exact commit and allows publication", () => {
    expect(Object.keys(adminMessageReviews)).toEqual([...SUPPORTED_LOCALES]);
    for (const locale of SUPPORTED_LOCALES) {
      expect(adminMessageReviews[locale]).toMatchObject({
        schemaVersion: 1,
        namespace: "admin",
        status: "APPROVED",
        reviewer: "Cz",
      });
      expect(adminMessageReviews[locale].approvedCommit).toMatch(
        /^[a-f0-9]{40}$/u,
      );
      expect(() => assertAdminMessagesPublishable(locale)).not.toThrow();
    }
  });
});
