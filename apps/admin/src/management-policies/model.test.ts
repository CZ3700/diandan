import { expect, test } from "vitest";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
const subject = await import("./model").catch(() => undefined);
const fields = {
  title: "Delivery",
  summary: "Our delivery policy",
  body: "<p>Safe <strong>content</strong>.</p>",
};
const document = {
  kind: "DELIVERY",
  translations: SUPPORTED_LOCALES.map((locale) => ({
    locale,
    origin: "MACHINE",
    fields,
  })),
};
test("the seven language package preserves machine provenance and rejects executable HTML", () => {
  expect(subject?.parsePolicyPackage).toBeTypeOf("function");
  const parsed = subject!.parsePolicyPackage(
    JSON.stringify({ schemaVersion: 1, documents: [document] }),
  );
  expect(
    parsed.documents[0]?.translations.every((row) => row.origin === "MACHINE"),
  ).toBe(true);
  expect(() =>
    subject!.parsePolicyPackage(
      JSON.stringify({
        schemaVersion: 1,
        documents: [
          {
            ...document,
            translations: document.translations.map((row) => ({
              ...row,
              fields: { ...fields, body: '<p onclick="alert(1)">Bad</p>' },
            })),
          },
        ],
      }),
    ),
  ).toThrow();
});
test("packages require each locale exactly once and never accept approval evidence", () => {
  expect(subject?.parsePolicyPackage).toBeTypeOf("function");
  for (const translations of [
    document.translations.slice(1),
    [...document.translations.slice(1), document.translations[1]],
    document.translations.map((row) => ({ ...row, approved: true })),
  ]) {
    expect(() =>
      subject!.parsePolicyPackage(
        JSON.stringify({
          schemaVersion: 1,
          documents: [{ ...document, translations }],
        }),
      ),
    ).toThrow();
  }
  expect(() =>
    subject!.parsePolicyPackage(
      JSON.stringify({ schemaVersion: 1, documents: [document, document] }),
    ),
  ).toThrow();
});
test("draft changes preserve unchanged translations and explicitly replace only edited content", () => {
  expect(subject?.policyChanges).toBeTypeOf("function");
  const baseline = {
    effectiveAt: "2026-10-04T00:00:00.000Z",
    kind: "DELIVERY" as const,
    translations: [
      { locale: "en" as const, origin: "MACHINE" as const, fields },
    ],
  };
  const draft = {
    ...baseline,
    translations: [
      {
        ...baseline.translations[0]!,
        fields: { ...fields, title: "Updated delivery" },
      },
    ],
  };
  expect(subject!.policyChanges(baseline, baseline)).toEqual({
    kind: "POLICY",
  });
  expect(subject!.policyChanges(baseline, draft)).toEqual({
    kind: "POLICY",
    translations: draft.translations,
  });
  expect(baseline.translations[0]?.origin).toBe("MACHINE");
});
test("an explicit source refresh submits unchanged translations without manufacturing approval", () => {
  const baseline = {
    effectiveAt: "2027-01-01T00:00:00Z",
    kind: "DELIVERY" as const,
    translations: [
      { locale: "ja" as const, origin: "MACHINE" as const, fields },
    ],
  };
  const draft = { ...baseline, refreshLocales: ["ja" as const] };
  expect(subject!.samePolicyDraft(baseline, draft)).toBe(false);
  expect(subject!.policyChanges(baseline, draft)).toEqual({
    kind: "POLICY",
    translations: baseline.translations,
  });
});
test("translation editing can retain existing or unreadable effective time while new dates must be future", () => {
  expect(
    subject?.validPolicyEffectiveTime(
      "2026-01-01T00:00:00Z",
      "2026-01-01T00:00:00Z",
      Date.parse("2026-10-03T00:00:00Z"),
    ),
  ).toBe(true);
  expect(subject!.validPolicyEffectiveTime("", "", Date.now())).toBe(true);
  expect(subject!.validPolicyEffectiveTime(null, "", Date.now())).toBe(false);
  expect(
    subject!.validPolicyEffectiveTime(
      null,
      "2026-01-01T00:00:00Z",
      Date.parse("2026-10-03T00:00:00Z"),
    ),
  ).toBe(false);
});
