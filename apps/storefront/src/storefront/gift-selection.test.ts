import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { parseGiftSelection, giftSelectionHref } from "./gift-selection";
import * as legacy from "./gift-selection";
import * as pureSelection from "./gift-selection-values";

function declarationModule(name: string) {
  const entry = new URL("./gift-selection.ts", import.meta.url);
  const source = ts.createSourceFile(
    "gift-selection.ts",
    readFileSync(entry, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name)
      return source;
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause) &&
      statement.exportClause.elements.some(
        (element) => element.name.text === name,
      )
    ) {
      const file = new URL(
        statement.moduleSpecifier.text.replace(/(?:\.js)?$/u, ".ts"),
        entry,
      );
      return ts.createSourceFile(
        file.pathname,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
    }
  }
  throw new Error(`Missing selection export: ${name}`);
}

it.each(["giftSelectionHref", "giftCanonicalPath", "selectGiftOffer"])(
  "%s is declared independently of raw query schemas",
  (name) => {
    const source = declarationModule(name);
    const runtimeContracts = source.statements.filter(
      (statement) =>
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === "@fan-support/contracts" &&
        !statement.importClause?.isTypeOnly,
    );
    expect(runtimeContracts).toHaveLength(0);
  },
);

it("retains the legacy exports as the same pure function bindings", () => {
  expect(Object.keys(legacy).sort()).toEqual([
    "giftCanonicalPath",
    "giftRecoveryQuery",
    "giftSelectionHref",
    "parseGiftSelection",
    "selectGiftOffer",
  ]);
  for (const key of Object.keys(
    pureSelection,
  ) as (keyof typeof pureSelection)[])
    expect(legacy[key]).toBe(pureSelection[key]);
});

describe("gift detail selection URLs", () => {
  it("requires explicit market and currency independently from locale", () => {
    expect(parseGiftSelection({}).kind).toBe("CONTEXT_REQUIRED");
    expect(parseGiftSelection({ market: "TEST" }).kind).toBe("INVALID_QUERY");
    expect(
      parseGiftSelection({ market: "TEST", currency: "JPY" }),
    ).toMatchObject({ kind: "VALID", market: "TEST", currency: "JPY" });
  });
  it("rejects duplicate scope, malformed recipient and variant instead of silently changing selection", () => {
    for (const extra of [
      { market: ["TEST", "TEST"] },
      { idol: "oops" },
      { variant: "oops" },
      { currency: "" },
    ]) {
      expect(
        parseGiftSelection({ market: "TEST", currency: "USD", ...extra }).kind,
      ).toBe("INVALID_QUERY");
    }
  });
  it("preserves market, currency and gift when changing artist, resets variant and page", () => {
    const result = giftSelectionHref(
      "ja",
      "/gifts/flower",
      "market=TEST&currency=USD&variant=old&page=3&campaign=summer",
      { idol: "11111111-1111-4111-8111-111111111111" },
    );
    expect(result).toBe(
      "/ja/gifts/flower?market=TEST&currency=USD&campaign=summer&idol=11111111-1111-4111-8111-111111111111",
    );
  });
  it("never accepts an external destination", () => {
    expect(() =>
      giftSelectionHref("en", "//evil.test", "", {
        market: "TEST",
        currency: "USD",
      }),
    ).toThrow();
  });
});

it("recovers from invalid filters while preserving valid recipient and commercial context", async () => {
  const imported = await import("./gift-selection");
  const recovery = (imported as unknown as Record<string, unknown>)[
    "giftRecoveryQuery"
  ];
  expect(typeof recovery).toBe("function");
  if (typeof recovery !== "function") return;
  expect(
    recovery(
      "market=TEST&currency=USD&category=bad&sort=nope&page=4&idol=11111111-1111-4111-8111-111111111111&campaign=summer",
    ),
  ).toBe(
    "market=TEST&currency=USD&idol=11111111-1111-4111-8111-111111111111&campaign=summer",
  );
  expect(
    recovery("market=TEST&market=OTHER&currency=USD&idol=nope&variant=bad"),
  ).toBe("currency=USD");
});

it("keeps navigation identifiers and tracking values out of canonical metadata", async () => {
  const imported = await import("./gift-selection");
  const canonical = (imported as unknown as Record<string, unknown>)[
    "giftCanonicalPath"
  ];
  expect(typeof canonical).toBe("function");
  if (typeof canonical !== "function") return;
  expect(
    canonical(
      "en",
      "/gifts",
      "market=TEST&currency=USD&page=2&sort=PRICE_ASC&cart=private-value&paymentAttempt=private-value&campaign=summer",
    ),
  ).toBe("/en/gifts?market=TEST&currency=USD&page=2&sort=PRICE_ASC");
});
